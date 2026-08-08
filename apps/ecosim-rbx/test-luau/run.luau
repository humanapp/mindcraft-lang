--[[
	Entry point for `npm run test:luau`.

	Loads packages/core's Roblox build and this app's compiled output on the
	Lune Luau runtime and exercises them the way a Studio session would, which
	is the only place emit-level and module-init defects show up. Exits non-zero
	on the first failing check reported by any suite.
]]

local process = require("@lune/process")

local Expect = require("./lib/expect")
local World = require("./lib/world")
local coreSentinels = require("./suites/core-sentinels")
local brainRuntime = require("./suites/brain-runtime")

local expect = Expect.new()
local world = World.build()

coreSentinels.run(world, expect)
local run = brainRuntime.run(world, expect)

print(
	string.format(
		"ecosim-rbx luau harness: %d frames, %0.1fs sim time, %d blips fired",
		run.frames,
		run.simTimeMs / 1000,
		run.blips
	)
)
process.exit(expect:report("checks"))
