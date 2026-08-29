import type { z } from "zod";
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
  /** The client could not run the call, so nothing of it reached a tool. */
  ServingFailed: "serving_failed",
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

/**
 * One schema failure as the `detail` of a {@link ToolCallError} reports it:
 * the path that failed and the issue's code, followed by the bound it ran into
 * when the issue names one, so a call refused for being too large reads back
 * the size it may take.
 */
function issueDetail(issue: z.core.$ZodIssue): string {
  const at = issue.path.join(".") || "<root>";
  if (issue.code === "too_big") return `${at}: ${issue.code} (maximum ${String(issue.maximum)})`;
  if (issue.code === "too_small") return `${at}: ${issue.code} (minimum ${String(issue.minimum)})`;
  return `${at}: ${issue.code}`;
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
      detail: parsed.error.issues.map(issueDetail).join("; "),
    };
    return { payload, isError: true };
  }
  return { payload: await runTool(workspace, name, input) };
}
