export type { TargetAdapter } from "../target/adapter.js";
export { createTargetAdapter, FAKE_INPUT_KIND, FAKE_SUBJECT, FAKE_TARGET_IDENTITY } from "./fake-adapter.js";
export type { FakeWorldState } from "./fake-module.js";
export { createFakeModule, FAKE_EMIT_GRAMMAR_NOTE, FakeActionKeys, FakeTileIds } from "./fake-module.js";
export { ruleIdAt } from "./rule-addressing.js";
