--[[
	A virtual Roblox instance tree and module loader for the Lune runtime.

	Rojo materialises directories as Folders and ModuleScripts; roblox-ts output
	navigates that tree through `game:GetService`, `WaitForChild`, and `Parent`,
	then loads modules through the roblox-ts RuntimeLib. This module rebuilds
	just enough of that world -- filesystem mounting, instance navigation, and a
	memoising `require` -- to run emitted Luau outside Roblox.
]]

local datetime = require("@lune/datetime")
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local roblox = require("@lune/roblox")
local serde = require("@lune/serde")
local task = require("@lune/task")

local M = {}

local instanceMethods = {}

--[[
	Creates one instance node.

	name: the instance Name.
	className: "Folder" or "ModuleScript".
	path: source file backing a ModuleScript, or nil for a Folder.
]]
local function newNode(name, className, path)
	local node = {
		Name = name,
		ClassName = className,
		Parent = nil,
		_children = {},
		_path = path,
	}
	return setmetatable(node, {
		__index = function(self, key)
			local method = instanceMethods[key]
			if method ~= nil then
				return method
			end
			return rawget(self, "_children")[key]
		end,
		__tostring = function(self)
			return rawget(self, "Name")
		end,
	})
end

function instanceMethods:FindFirstChild(name)
	return rawget(self, "_children")[name]
end

function instanceMethods:WaitForChild(name)
	local child = rawget(self, "_children")[name]
	if child == nil then
		error(string.format("WaitForChild: %s has no child %q", self:GetFullName(), tostring(name)), 2)
	end
	return child
end

function instanceMethods:GetChildren()
	local out = {}
	for _, child in rawget(self, "_children") do
		table.insert(out, child)
	end
	return out
end

function instanceMethods:GetFullName()
	local parts = {}
	local node = self
	while node ~= nil do
		table.insert(parts, 1, rawget(node, "Name"))
		node = rawget(node, "Parent")
	end
	return table.concat(parts, ".")
end

function instanceMethods:IsA(className)
	return rawget(self, "ClassName") == className
end

function instanceMethods:FindFirstAncestorWhichIsA(className)
	local node = rawget(self, "Parent")
	while node ~= nil do
		if rawget(node, "ClassName") == className then
			return node
		end
		node = rawget(node, "Parent")
	end
	return nil
end

--[[
	Parents `child` under `parent` and returns the child.
]]
local function addChild(parent, child)
	rawget(parent, "_children")[rawget(child, "Name")] = child
	rawset(child, "Parent", parent)
	return child
end
M.addChild = addChild

--[[
	Creates an empty Folder node with the given name.
]]
local function newFolder(name)
	return newNode(name, "Folder", nil)
end
M.newFolder = newFolder

local SCRIPT_EXTENSIONS = { [".luau"] = true, [".lua"] = true }
local INIT_NAMES = { ["init.luau"] = true, ["init.lua"] = true }

local function splitExtension(fileName)
	local dot = string.find(fileName, "%.[^%.]*$")
	if dot == nil then
		return fileName, ""
	end
	return string.sub(fileName, 1, dot - 1), string.sub(fileName, dot)
end

--[[
	Mounts a filesystem path as an instance node the way Rojo does.

	A directory holding init.luau becomes a ModuleScript backed by that file
	with the sibling entries as children; any other directory becomes a Folder.
	Files ending in .luau, .lua, or .json become ModuleScripts named without the
	extension. Everything else (declaration files, source maps) is skipped.

	Returns the node, or nil when the path maps to nothing.
]]
local function mount(path, name)
	if not fs.isDir(path) then
		local base, extension = splitExtension(name)
		if SCRIPT_EXTENSIONS[extension] or extension == ".json" then
			return newNode(base, "ModuleScript", path)
		end
		return nil
	end

	local entries = fs.readDir(path)
	local initPath = nil
	for _, entry in entries do
		if INIT_NAMES[entry] then
			initPath = path .. "/" .. entry
		end
	end

	local node
	if initPath ~= nil then
		node = newNode(name, "ModuleScript", initPath)
	else
		node = newNode(name, "Folder", nil)
	end

	for _, entry in entries do
		if not INIT_NAMES[entry] then
			local child = mount(path .. "/" .. entry, entry)
			if child ~= nil then
				addChild(node, child)
			end
		end
	end
	return node
end
M.mount = mount

--[[
	Builds the DataModel stand-in and the loader that runs mounted
	ModuleScripts.

	Returns a table with:
	  getService  resolves a service on the DataModel stand-in, creating it on
	              first use;
	  require     loads a ModuleScript node, memoising by node and raising on
	              require cycles.
]]
function M.newDataModel()
	local services = {}

	local runService = {
		Name = "RunService",
		ClassName = "RunService",
		IsStudio = function()
			return false
		end,
		IsRunning = function()
			return false
		end,
		IsClient = function()
			return false
		end,
		IsServer = function()
			return true
		end,
	}

	local game
	game = {
		Name = "game",
		ClassName = "DataModel",
		Parent = nil,
		Loaded = {
			Wait = function() end,
		},
		GetService = function(_self, serviceName)
			if serviceName == "RunService" then
				return runService
			end
			local service = services[serviceName]
			if service == nil then
				service = newFolder(serviceName)
				rawset(service, "ClassName", serviceName)
				rawset(service, "Parent", game)
				services[serviceName] = service
			end
			return service
		end,
		IsLoaded = function()
			return true
		end,
		FindFirstAncestorWhichIsA = function()
			return nil
		end,
	}

	local sharedGlobals = {}
	local loaded = {}
	local loading = {}
	local requireNode

	local function nowMillis()
		return datetime.now().unixTimestampMillis
	end

	local function makeEnvironment(node)
		return {
			script = node,
			require = requireNode,
			game = game,
			_G = sharedGlobals,
			task = task,
			typeIs = function(value, kind)
				return typeof(value) == kind
			end,
			Vector2 = roblox.Vector2,
			Vector3 = roblox.Vector3,
			DateTime = {
				now = function()
					return { UnixTimestampMillis = nowMillis() }
				end,
			},
			tick = function()
				return nowMillis() / 1000
			end,
		}
	end

	function requireNode(target)
		if typeof(target) ~= "table" or rawget(target, "ClassName") ~= "ModuleScript" then
			error("require expected a ModuleScript, got " .. tostring(target), 2)
		end
		local cached = loaded[target]
		if cached ~= nil then
			return cached.value
		end
		if loading[target] then
			error("require cycle detected at " .. target:GetFullName(), 2)
		end

		local path = rawget(target, "_path")
		loading[target] = true

		local value
		if string.sub(path, -5) == ".json" then
			value = serde.decode("json", fs.readFile(path))
		else
			local chunk = luau.load(luau.compile(fs.readFile(path)), {
				debugName = target:GetFullName(),
				environment = makeEnvironment(target),
			})
			value = chunk()
		end

		loading[target] = nil
		loaded[target] = { value = value }
		return value
	end

	return {
		require = requireNode,
		getService = function(serviceName)
			return game:GetService(serviceName)
		end,
	}
end

return M
