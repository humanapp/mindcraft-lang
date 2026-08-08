--[[
	Cheap, explicit sentinels for the Luau-only core defects that shipped
	against this app. Each one fails loudly on the emitted Luau while the Node
	suite stays green, which is the whole reason this harness exists.
]]

local Suite = {}

--[[
	Runs the sentinels against the mounted world, recording every check on
	`expect`.
]]
function Suite.run(world, expect)
	-- F18: the brain barrel used to form a module-init require cycle
	-- (brain -> model -> brain-json-codec -> braindef -> brain). The loader
	-- raises on a cycle, so reaching these symbols is the assertion.
	local brainBarrel = world.core("brain")
	expect:ok("F18 core brain barrel loads", brainBarrel ~= nil, "brain barrel returned nil")
	local model = world.core("brain", "model")
	expect:equal("F18 brain/model exports BrainDef", typeof(model.BrainDef), "table")
	expect:equal("F18 brain/model exports brainJsonFromPlain", typeof(model.brainJsonFromPlain), "function")

	-- F20: `isArray` used to emit string arithmetic on the element access, so
	-- it threw on Luau the moment it was called. It reports true for values
	-- exposing `size` and `push` members, which is what core's List is.
	local app = world.core("app")
	local TypeUtils = world.core("platform", "types").TypeUtils
	expect:equal("F20 TypeUtils.isArray on a List", TypeUtils.isArray(app.List.new()), true)
	expect:equal("F20 TypeUtils.isArray on a plain table", TypeUtils.isArray({ 1, 2, 3 }), false)
	expect:equal("F20 TypeUtils.isArray on a number", TypeUtils.isArray(7), false)

	-- F23: bit32 returns 0 for shift counts of 32 or more, so every bit at or
	-- above the app capability offset silently vanished.
	local BitSet = world.core("util", "bitset").BitSet
	local offset = app.APP_CAPABILITY_BIT_OFFSET
	expect:equal("F23 APP_CAPABILITY_BIT_OFFSET", offset, 32)

	local bits = BitSet.new()
	bits:set(0)
	bits:set(31)
	bits:set(offset)
	bits:set(offset + 1)
	expect:equal("F23 BitSet bit 0", bits:get(0), 1)
	expect:equal("F23 BitSet bit 31", bits:get(31), 1)
	expect:equal("F23 BitSet bit 32", bits:get(offset), 1)
	expect:equal("F23 BitSet bit 33", bits:get(offset + 1), 1)
	expect:equal("F23 BitSet unset bit 34", bits:get(offset + 2), 0)
	expect:equal("F23 BitSet cardinality", bits:cardinality(), 4)

	bits:set(offset + 1, 0)
	expect:equal("F23 BitSet clears bit 33", bits:get(offset + 1), 0)
	expect:equal("F23 BitSet keeps bit 32 after clearing 33", bits:get(offset), 1)
end

return Suite
