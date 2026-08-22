--[[
	Runs the three shipped brains on the emitted Luau for 660 scripted frames.

	The environment is built from core's `coreModule` plus this app's compiled
	`createEcosimModule`, the brain assets are deserialized through the same
	entry point the server uses, and the real `Actor`, `Mover`, and vision
	modules drive a headless host. Stimuli are injected in fixed frame windows
	so every assertion is a behavioural consequence of a rule firing: energy
	transferred, steering queued, a blip spawned, a speech bubble raised.
]]

local Host = require("../stubs/host")

local Suite = {}

local FRAME_MS = 1000 / 60

--- Energy a single eat bite transfers, from actions/eat.ts.
local BITE_ENERGY = 30

--- Frame counts per scripted window; the run is the sum of these.
local FREE_RUN_FRAMES = 180
local SIGHT_FRAMES = 240
local GRAZE_FRAMES = 120
local PREDATION_FRAMES = 120

local function deepCopy(value)
	if typeof(value) ~= "table" then
		return value
	end
	local copy = {}
	for key, item in value do
		copy[key] = deepCopy(item)
	end
	return copy
end

--[[
	Wraps the actor's mover so the harness can see the steering contributions
	each frame without reading state the actor clears at the end of its tick.
]]
local function observeSteering(actor)
	local record = { calls = 0, maxSpeedMultiplier = 0 }
	local mover = actor.mover
	local original = mover.step
	mover.step = function(selfMover, sprite, dtSec, contributions)
		record.calls += 1
		for _, contribution in contributions do
			local multiplier = contribution.speedMultiplier or 1
			if multiplier > record.maxSpeedMultiplier then
				record.maxSpeedMultiplier = multiplier
			end
		end
		return original(selfMover, sprite, dtSec, contributions)
	end
	return record
end

--[[
	Wraps the actor's energy transfer methods so eat bites are observable as
	discrete amounts rather than as a net energy delta the passive decay and
	movement cost would blur.
]]
local function observeEnergy(actor)
	local record = { drains = {}, gains = {} }
	local originalDrain = actor.drainEnergy
	local originalGain = actor.gainEnergy
	actor.drainEnergy = function(selfActor, amount)
		table.insert(record.drains, amount)
		return originalDrain(selfActor, amount)
	end
	actor.gainEnergy = function(selfActor, amount)
		table.insert(record.gains, amount)
		return originalGain(selfActor, amount)
	end
	return record
end

local function resetSteering(record)
	record.maxSpeedMultiplier = 0
end

local function countAtLeast(values, threshold, from)
	local total = 0
	for index = from or 1, #values do
		if values[index] >= threshold then
			total += 1
		end
	end
	return total
end

--[[
	Runs the suite against the mounted world, recording every check on
	`expect`.
]]
function Suite.run(world, expect)
	local app = world.core("app")
	local brainModule = world.server("brain")
	local vision = world.server("brain", "vision")
	local Actor = world.server("brain", "actor").Actor
	local ARCHETYPES = world.server("brain", "archetypes").ARCHETYPES
	local NAMESPACE = world.server("brain", "engine-constants").ECOSIM_RBX_NAMESPACE

	-- Record every diagnostic the host or the actions emit. Actions catch their
	-- own errors and log them, so a Luau-only fault inside an action body is
	-- invisible in the return value but shows up here.
	local diagnostics = { errors = {}, warnings = {} }
	local logger = app.logger
	logger.error = function(_self, message)
		table.insert(diagnostics.errors, tostring(message))
	end
	logger.warn = function(_self, message)
		table.insert(diagnostics.warnings, tostring(message))
	end

	local environment = app.createWendooEnvironment({
		modules = { app.coreModule(), brainModule.createEcosimModule() },
	})

	-- Every brain the actors build routes its fiber faults here, on top of the
	-- host's own handler.
	local faults = {}
	local originalCreateBrain = environment.createBrain
	environment.createBrain = function(selfEnv, definition, options)
		local hostHandler = options.vmEvents ~= nil and options.vmEvents.onFiberFault or nil
		options.vmEvents = {
			onFiberFault = function(event)
				table.insert(faults, event)
				if hostHandler ~= nil then
					hostHandler(event)
				end
			end,
		}
		return originalCreateBrain(selfEnv, definition, options)
	end

	local brainDefs = {}
	for archetype, assetName in
		{ carnivore = "default-carnivore", herbivore = "default-herbivore", plant = "default-plant" }
	do
		local plain = world.shared("brains", assetName)
		local definition = environment:deserializeBrainJsonFromPlain(deepCopy(plain), NAMESPACE)
		brainDefs[archetype] = definition
		expect:equal(string.format("%s brain asset deserializes to one page", archetype), definition:pages():size(), 1)
		expect:greater(
			string.format("%s brain page has rules", archetype),
			definition:pages():get(0):children():size(),
			0
		)
	end

	local engine = Host.Engine.new(environment, vision, app.Vector2)
	local nextActorId = 1

	local function spawn(archetype, x, y, rotation)
		local config = ARCHETYPES[archetype]
		local actor = Actor.new(engine, archetype, brainDefs[archetype], config.mover)
		actor.actorId = nextActorId
		nextActorId += 1
		engine:register(actor, x, y, rotation, config.physics.mass)
		return actor
	end

	local carnivore = spawn("carnivore", 200, 200, 0)
	local herbivore = spawn("herbivore", 1400, 200, math.pi)
	local plant = spawn("plant", 800, 1000, 0)

	local steering = {
		carnivore = observeSteering(carnivore),
		herbivore = observeSteering(herbivore),
	}
	local energy = {
		carnivore = observeEnergy(carnivore),
		herbivore = observeEnergy(herbivore),
		plant = observeEnergy(plant),
	}

	-- Page activation carries the capability bits up from the tiles. Both app
	-- capability bits live at or above bit 32, so a BitSet that drops high bits
	-- leaves hasVision false on every actor and the vision query never runs.
	expect:equal("carnivore page activation reports vision", carnivore.hasVision, true)
	expect:equal("herbivore page activation reports vision", herbivore.hasVision, true)
	expect:equal("plant page activation reports vision", plant.hasVision, true)

	local sightSeen = { carnivore = 0, herbivore = 0, plant = 0 }
	local targetsRecorded = { carnivore = false, herbivore = false, plant = false }

	local function sample()
		for name, actor in { carnivore = carnivore, herbivore = herbivore, plant = plant } do
			local queued = #actor.sightQueue
			if queued > sightSeen[name] then
				sightSeen[name] = queued
			end
			if next(actor.debugTargetPositions) ~= nil then
				targetsRecorded[name] = true
			end
		end
	end

	-- Window 1: free run. No stimuli, actors far apart, positions integrated
	-- from the velocities the mover writes.
	for _ = 1, FREE_RUN_FRAMES do
		engine:step(FRAME_MS)
		sample()
	end
	expect:equal("free run raises no fiber faults", #faults, 0)
	expect:equal("free run logs no errors", #diagnostics.errors, 0)
	expect:greater("free run drives the movers", steering.carnivore.calls, 0)

	-- Window 2: sight. Positions are held so the vision cones stay aimed:
	-- the herbivore faces the plant, the carnivore faces the herbivore, and
	-- the plant sees the carnivore through its full-circle cone.
	for _, actor in { carnivore, herbivore, plant } do
		actor.sprite.pinned = true
	end
	herbivore.energy = 50 -- below the 0.75 gate on the forage rule

	local function holdLayout()
		carnivore.sprite.x, carnivore.sprite.y, carnivore.sprite.rotation = 900, 600, math.pi
		herbivore.sprite.x, herbivore.sprite.y, herbivore.sprite.rotation = 700, 600, 0
		plant.sprite.x, plant.sprite.y, plant.sprite.rotation = 800, 600, 0
	end

	local blipsBeforeSight = engine.blipCount
	resetSteering(steering.carnivore)
	resetSteering(steering.herbivore)
	for _ = 1, SIGHT_FRAMES do
		holdLayout()
		engine:step(FRAME_MS)
		sample()
	end

	expect:greater("carnivore sight queue fills", sightSeen.carnivore, 0)
	expect:greater("herbivore sight queue fills", sightSeen.herbivore, 0)
	expect:greater("plant sight queue fills", sightSeen.plant, 0)
	expect:ok("carnivore see sensor records a target", targetsRecorded.carnivore, "no target position recorded")
	expect:ok("herbivore see sensor records a target", targetsRecorded.herbivore, "no target position recorded")
	-- Each brain's fallback movement rule is a plain wander, so the speed
	-- multiplier separates sight-driven steering from it: the carnivore's
	-- pursuit carries `quickly` (above 1) and the herbivore's forage carries no
	-- modifier (exactly 1) against a wander damped by three `slowly` tiles.
	expect:greater("carnivore queues pursuit steering", steering.carnivore.maxSpeedMultiplier, 1)
	expect:atLeast("herbivore queues forage steering", steering.herbivore.maxSpeedMultiplier, 1)
	expect:greater("plant shoots at the carnivore it sees", engine.blipCount - blipsBeforeSight, 0)

	-- Window 3: grazing. The herbivore bumps the plant, which fires the
	-- bump-eat rule and, nested under it, the say rule. The eat actuator has no
	-- explicit target argument, so a landed bite also proves the sensor's
	-- targetActor rule variable reached the actuator.
	local plantDrainsBefore = #energy.plant.drains
	local herbivoreGainsBefore = #energy.herbivore.gains
	local herbivoreSpeechBefore = herbivore.visuals.speechSets
	for _ = 1, GRAZE_FRAMES do
		holdLayout()
		herbivore:enqueueBump(plant.actorId)
		plant:enqueueBump(herbivore.actorId)
		engine:step(FRAME_MS)
		sample()
	end

	expect:greater(
		"herbivore bites the plant for the full bite amount",
		countAtLeast(energy.plant.drains, BITE_ENERGY, plantDrainsBefore + 1),
		0
	)
	expect:greater(
		"herbivore gains energy from the bite",
		countAtLeast(energy.herbivore.gains, 1, herbivoreGainsBefore + 1),
		0
	)
	expect:greater(
		"herbivore child rule raises a speech bubble",
		herbivore.visuals.speechSets - herbivoreSpeechBefore,
		0
	)

	-- Window 4: predation. The carnivore bumps the herbivore, which fires the
	-- carnivore's own bump-eat plus child-say pair and the herbivore's
	-- bump-carnivore flee rule with its quickly modifiers.
	local carnivoreGainsBefore = #energy.carnivore.gains
	local carnivoreSpeechBefore = carnivore.visuals.speechSets
	local herbivoreSpeechMid = herbivore.visuals.speechSets
	steering.herbivore.maxSpeedMultiplier = 0
	for _ = 1, PREDATION_FRAMES do
		holdLayout()
		carnivore:enqueueBump(herbivore.actorId)
		herbivore:enqueueBump(carnivore.actorId)
		engine:step(FRAME_MS)
		sample()
	end

	expect:greater(
		"carnivore gains energy from biting the herbivore",
		countAtLeast(energy.carnivore.gains, 1, carnivoreGainsBefore + 1),
		0
	)
	expect:greater(
		"carnivore child rule raises a speech bubble",
		carnivore.visuals.speechSets - carnivoreSpeechBefore,
		0
	)
	expect:greater(
		"herbivore flee child rule raises a speech bubble",
		herbivore.visuals.speechSets - herbivoreSpeechMid,
		0
	)
	expect:greater("herbivore flee steering carries a speed boost", steering.herbivore.maxSpeedMultiplier, 1)

	local frames = FREE_RUN_FRAMES + SIGHT_FRAMES + GRAZE_FRAMES + PREDATION_FRAMES
	expect:greater("the run covers at least 600 frames", frames, 599)
	expect:equal("no fiber faults across the run", #faults, 0)
	expect:equal("no errors logged across the run", #diagnostics.errors, 0)
	expect:equal("no warnings logged across the run", #diagnostics.warnings, 0)

	for index = 1, math.min(#diagnostics.errors, 5) do
		print(string.format("       logged error: %s", diagnostics.errors[index]))
	end
	for index = 1, math.min(#diagnostics.warnings, 5) do
		print(string.format("       logged warning: %s", diagnostics.warnings[index]))
	end
	for index = 1, math.min(#faults, 5) do
		local fault = faults[index]
		print(string.format("       fiber fault: fiberId=%s code=%s", tostring(fault.fiberId), tostring(fault.err.code)))
	end

	return {
		frames = frames,
		blips = engine.blipCount,
		simTimeMs = engine.simTime,
	}
end

return Suite
