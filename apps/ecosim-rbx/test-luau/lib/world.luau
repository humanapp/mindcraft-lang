--[[
	Mounts this app's compiled output and packages/core's Roblox build into a
	virtual DataModel, then exposes the roblox-ts RuntimeLib import entry points
	the suites use.

	The mount mirrors default.project.json: `out/server` at
	ServerScriptService.TS, `out/shared` at ReplicatedStorage.TS, `include` at
	ReplicatedStorage.rbxts_include, and the core package under
	rbxts_include.node_modules, named by core's own Rojo project name so the
	`TS.import` path the compiler emits resolves unchanged.
]]

local fs = require("@lune/fs")
local process = require("@lune/process")
local serde = require("@lune/serde")

local rbx = require("./roblox-env")

local World = {}

local CORE_PACKAGE_DIR = "node_modules/@wendoo-lang/core"

local function requireDir(path, hint)
	if not fs.isDir(path) then
		error(string.format("missing %s -- run `npm run build` first (%s)", path, hint), 0)
	end
end

--[[
	Builds the virtual world.

	Must be called with the working directory set to the app root; the npm
	`test:luau` script guarantees that.

	Returns a table with:
	  core    imports a module from the core package by path segments;
	  server  imports a module from out/server by path segments;
	  shared  imports a module from out/shared by path segments.
]]
function World.build()
	local appRoot = process.cwd
	if not fs.isFile(appRoot .. "default.project.json") then
		error("test-luau must run with the app root as the working directory", 0)
	end

	requireDir(appRoot .. "out/server", "app server output")
	requireDir(appRoot .. "out/shared", "app shared output")
	requireDir(appRoot .. "include", "roblox-ts runtime include")

	local coreProject = serde.decode("json", fs.readFile(appRoot .. CORE_PACKAGE_DIR .. "/default.project.json"))
	local corePath = appRoot .. CORE_PACKAGE_DIR .. "/" .. coreProject.tree["$path"]
	requireDir(corePath, "packages/core Roblox target")

	local dm = rbx.newDataModel()
	local replicatedStorage = dm.getService("ReplicatedStorage")
	local serverScriptService = dm.getService("ServerScriptService")

	local include = rbx.mount(appRoot .. "include", "rbxts_include")
	rbx.addChild(replicatedStorage, include)

	local nodeModules = rbx.addChild(include, rbx.newFolder("node_modules"))
	rbx.addChild(nodeModules, rbx.mount(appRoot .. "node_modules/@rbxts", "@rbxts"))
	local scope = rbx.addChild(nodeModules, rbx.newFolder("@wendoo-lang"))
	local coreNode = rbx.addChild(scope, rbx.mount(corePath, coreProject.name))

	rbx.addChild(replicatedStorage, rbx.mount(appRoot .. "out/shared", "TS"))
	rbx.addChild(serverScriptService, rbx.mount(appRoot .. "out/server", "TS"))

	-- TS.import refuses a context equal to the module it loads, so the harness
	-- imports through a node of its own rather than through a mounted module.
	local context = rbx.addChild(serverScriptService, rbx.newFolder("LuauHarness"))

	local TS = dm.require(include:WaitForChild("RuntimeLib"))

	return {
		core = function(...)
			return TS.import(context, coreNode, ...)
		end,
		server = function(...)
			return TS.import(context, serverScriptService, "TS", ...)
		end,
		shared = function(...)
			return TS.import(context, replicatedStorage, "TS", ...)
		end,
	}
end

return World
