--[[
	Assertion recorder for the Luau harness.

	Every check carries a stable name so a failure identifies itself without
	depending on any user-facing wording produced by the code under test.
]]

local Expect = {}
Expect.__index = Expect

--[[
	Creates an empty recorder.
]]
function Expect.new()
	return setmetatable({ passed = 0, failures = {} }, Expect)
end

local function fail(self, name, detail)
	table.insert(self.failures, string.format("%s -- %s", name, detail))
end

--[[
	Records a pass when `condition` is truthy, otherwise a failure carrying
	`detail`.
]]
function Expect:ok(name, condition, detail)
	if condition then
		self.passed += 1
	else
		fail(self, name, detail or "expected a truthy value")
	end
	return condition and true or false
end

--[[
	Records a pass when `actual` equals `expected` by Luau equality.
]]
function Expect:equal(name, actual, expected)
	if actual == expected then
		self.passed += 1
		return true
	end
	fail(self, name, string.format("expected %s, got %s", tostring(expected), tostring(actual)))
	return false
end

--[[
	Records a pass when `actual` is strictly greater than `bound`.
]]
function Expect:greater(name, actual, bound)
	if typeof(actual) == "number" and actual > bound then
		self.passed += 1
		return true
	end
	fail(self, name, string.format("expected a number greater than %s, got %s", tostring(bound), tostring(actual)))
	return false
end

--[[
	Records a pass when `actual` is greater than or equal to `bound`.
]]
function Expect:atLeast(name, actual, bound)
	if typeof(actual) == "number" and actual >= bound then
		self.passed += 1
		return true
	end
	fail(self, name, string.format("expected a number of at least %s, got %s", tostring(bound), tostring(actual)))
	return false
end

--[[
	Prints one summary line plus every failure, and returns the process exit
	code (0 when every check passed).
]]
function Expect:report(label)
	local failed = #self.failures
	for _, message in self.failures do
		print(string.format("FAIL %s", message))
	end
	print(string.format("%s: %d passed, %d failed", label, self.passed, failed))
	return if failed == 0 then 0 else 1
end

return Expect
