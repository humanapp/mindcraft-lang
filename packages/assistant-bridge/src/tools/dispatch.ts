import { compileBrain } from "./compile.js";
import { proposeEdit, proposeEditBatch } from "./propose-edit.js";
import { readCatalog } from "./read-catalog.js";
import { readProject } from "./read-project.js";
import { simulate } from "./simulate.js";
import { suggestTiles } from "./suggest-tiles.js";
import type { ToolName } from "./tool-schemas.js";
import { toolInputSchemas } from "./tool-schemas.js";
import type { AuthoringWorkspace } from "./workspace.js";

/** Why the bridge could not serve a call at all. */
export const ToolCallErrorCode = {
  /** The call named something other than one of the bridge tools. */
  UnknownTool: "unknown_tool",
  /** The input did not match the named tool's schema. */
  InvalidInput: "invalid_input",
} as const;

/** Why the bridge could not serve a call at all. */
export type ToolCallErrorCode = (typeof ToolCallErrorCode)[keyof typeof ToolCallErrorCode];

/** Payload returned for a call the bridge could not serve. */
export interface ToolCallError {
  readonly error: ToolCallErrorCode;
  /** What could not be accepted: the tool name, or a description of the schema failure. */
  readonly detail: string;
}

/** One call's outcome: the tool's payload, or the reason it was not served. */
export interface ToolCallOutcome {
  /** JSON-serializable payload, or a {@link ToolCallError} when `isError` is set. */
  readonly payload: unknown;
  /** `true` when the call was not served at all. */
  readonly isError?: boolean;
}

/** True when `name` is one of the bridge tools. */
export function isToolName(name: string): name is ToolName {
  return name in toolInputSchemas;
}

/** Run one validated call against the workspace. */
async function runTool(workspace: AuthoringWorkspace, name: ToolName, input: unknown): Promise<unknown> {
  switch (name) {
    case "compile":
      return compileBrain(workspace);
    case "propose_edit": {
      const edit = toolInputSchemas.propose_edit.parse(input);
      return edit.op === "batch" ? await proposeEditBatch(workspace, edit) : proposeEdit(workspace, edit);
    }
    case "read_catalog":
      return readCatalog(workspace, toolInputSchemas.read_catalog.parse(input));
    case "read_project":
      return readProject(workspace);
    case "simulate":
      return await simulate(workspace, toolInputSchemas.simulate.parse(input));
    case "suggest_tiles":
      return suggestTiles(workspace, toolInputSchemas.suggest_tiles.parse(input));
  }
}

/**
 * Execute one tool call by name against `workspace`, validating `input` against
 * the named tool's schema first. An unknown name or an input the schema refuses
 * comes back as an error outcome; a tool that refuses the request itself
 * reports through its own payload.
 */
export async function executeToolCall(
  workspace: AuthoringWorkspace,
  name: string,
  input: unknown
): Promise<ToolCallOutcome> {
  if (!isToolName(name)) {
    const payload: ToolCallError = { error: ToolCallErrorCode.UnknownTool, detail: name };
    return { payload, isError: true };
  }
  const parsed = toolInputSchemas[name].safeParse(input);
  if (!parsed.success) {
    const payload: ToolCallError = {
      error: ToolCallErrorCode.InvalidInput,
      detail: parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.code}`).join("; "),
    };
    return { payload, isError: true };
  }
  return { payload: await runTool(workspace, name, input) };
}
