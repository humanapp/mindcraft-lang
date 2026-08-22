--[[
	Headless stand-ins for the Roblox-facing half of the ecosim host.

	`src/server/world/` is the only part of the app that touches Roblox
	instances, so the harness supplies its own sprite and visuals facades and a
	minimal engine. Everything the brain module reaches through the execution
	context -- actor lookup, vision queries, the sprite surface, energy, blip
	spawning -- is provided here; the real `Actor`, `Mover`, and vision modules
	are loaded from the compiled output and exercised unchanged.
]]

local Host = {}

--- Milliseconds of simulation time one velocity step covers.
local MS_PER_SIM_STEP = 1000 / 60

--- Arena dimensions in simulation pixels, matching src/server/world/scale.ts.
local SIM_WORLD_WIDTH = 1600
local SIM_WORLD_HEIGHT = 1200

local Sprite = {}
Sprite.__index = Sprite

--[[
	Creates a sprite facade positioned at (x, y) with the given heading in
	radians and body mass in ecosim mass units.
]]
function Sprite.new(x, y, rotation, mass)
	return setmetatable({
		x = x,
		y = y,
		rotation = rotation,
		body = { mass = mass, velocity = { x = 0, y = 0 } },
		pinned = false,
	}, Sprite)
end

function Sprite:setPosition(x, y)
	self.x = x
	self.y = y
end

function Sprite:setRotation(rotation)
	self.rotation = rotation
end

function Sprite:setVelocity(vx, vy)
	if self.body ~= nil then
		self.body.velocity.x = vx
		self.body.velocity.y = vy
	end
end

function Sprite:sync() end

function Sprite:bindTouched(_handler) end

function Sprite:destroy()
	self.body = nil
end

--[[
	Integrates the cached position from the current velocity, standing in for
	the Roblox solver. A pinned sprite holds its position so a scripted
	scenario can keep two actors a fixed distance apart.
]]
function Sprite:advance(dtMs)
	if self.body == nil or self.pinned then
		return
	end
	local steps = dtMs / MS_PER_SIM_STEP
	self.x += self.body.velocity.x * steps
	self.y += self.body.velocity.y * steps
end

local Visuals = {}
Visuals.__index = Visuals

--[[
	Creates a visuals facade that counts the calls the actor makes on it.

	`speechSets` counts bubbles raised and `speechClears` counts bubbles taken
	down; the text itself is display prose and is deliberately not recorded.
]]
function Visuals.new()
	return setmetatable({ speechSets = 0, speechClears = 0, energyUpdates = 0 }, Visuals)
end

function Visuals:setSpeech(text)
	if text == nil then
		self.speechClears += 1
	else
		self.speechSets += 1
	end
end

function Visuals:setEnergy(_ratio)
	self.energyUpdates += 1
end

function Visuals:destroy() end

local Engine = {}
Engine.__index = Engine

--[[
	Creates the headless engine.

	environment: the Wendoo environment the actors' brains are built from.
	vision:      the compiled `server/brain/vision` module.
	Vector2:     core's Vector2 constructor, used for spawn positions.
]]
function Engine.new(environment, vision, Vector2)
	return setmetatable({
		env = environment,
		simTime = 0,
		tickCount = 0,
		worldWidth = SIM_WORLD_WIDTH,
		worldHeight = SIM_WORLD_HEIGHT,
		obstacles = {},
		actorList = {},
		actorsById = {},
		actorsByArchetype = { carnivore = {}, herbivore = {}, plant = {} },
		blipCount = 0,
		nextBlipId = 1,
		_vision = vision,
		_Vector2 = Vector2,
	}, Engine)
end

function Engine:getActorById(actorId)
	return self.actorsById[actorId]
end

function Engine:getActorsByArchetype(archetype)
	return self.actorsByArchetype[archetype]
end

function Engine:queryVisibleActors(selfActor, range, halfAngle)
	return self._vision.queryVisibleActors(
		selfActor,
		self.actorList,
		range,
		halfAngle,
		self.obstacles,
		selfActor.sightQueue
	)
end

function Engine:randomPosition()
	return self._Vector2.new(math.random() * SIM_WORLD_WIDTH, math.random() * SIM_WORLD_HEIGHT)
end

function Engine:spawnBlip(shooterActorId, x, y, dirX, dirY)
	self.blipCount += 1
	local blipId = self.nextBlipId
	self.nextBlipId += 1
	return { blipId = blipId, shooterActorId = shooterActorId, x = x, y = y, vx = dirX, vy = dirY, alive = true }
end

--[[
	Registers an already-constructed actor with the engine and gives it the
	sprite and visuals facades the real `Engine.spawn` would have attached.
]]
function Engine:register(actor, x, y, rotation, mass)
	actor.sprite = Sprite.new(x, y, rotation, mass)
	actor.visuals = Visuals.new()
	if actor.plantComp ~= nil then
		actor.plantComp.springAnchor = { x = x, y = y }
	end
	table.insert(self.actorList, actor)
	table.insert(self.actorsByArchetype[actor.archetype], actor)
	self.actorsById[actor.actorId] = actor
	return actor
end

--[[
	Runs one simulation frame in the same order as the real engine: sprite
	sync, physics components, tick counter, per-actor gameplay, clock advance,
	then position integration.
]]
function Engine:step(dtMs)
	for _, actor in self.actorList do
		actor.sprite:sync()
	end
	for _, actor in self.actorList do
		actor:physicsTick(self.simTime, dtMs)
	end
	self.tickCount += 1
	for _, actor in self.actorList do
		actor:tick(self.simTime, dtMs)
	end
	self.simTime += dtMs
	for _, actor in self.actorList do
		actor.sprite:advance(dtMs)
	end
end

Host.Engine = Engine

return Host
