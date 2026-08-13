import { z } from "zod";

/**
 * The rule side a tile sits on, in the spelling the model reads and writes.
 * Maps to core's numeric `RuleSide` at the bridge boundary.
 */
const ruleSideSchema = z.enum(["when", "do"]);

/** {@link ruleSideSchema} as a type. */
export type RuleSideName = z.infer<typeof ruleSideSchema>;

/** The id a tool names a rule by: the rule's own durable id. */
const ruleIdSchema = z
  .string()
  .describe(
    "Rule id, exactly as read_project reports it. It stays the rule's id as other rules come and go. Inside a batch, \"#N\" instead names the rule the batch's own command at index N creates."
  );

/** The id a tool names a page by: the page's own durable id. */
const pageIdSchema = z
  .string()
  .describe("Page id, exactly as read_project reports it. It stays the page's id as other pages come and go.");

/** The form a batch command names a rule an earlier command in the same batch created. */
const batchRulePattern = /^#(\d+)$/;

/** The form a batch command names the page tile of a page an earlier command in the same batch created. */
const batchPageTilePattern = /^#(\d+)\.page$/;

/**
 * The index of the batch command that creates the rule `ruleId` names. Returns
 * `undefined` for a durable rule id.
 */
export function batchRuleIndex(ruleId: string): number | undefined {
  const matched = batchRulePattern.exec(ruleId);
  return matched ? Number(matched[1]) : undefined;
}

/**
 * The index of the batch command whose page `tileId` names the page tile of.
 * Returns `undefined` for any other tile id.
 */
export function batchPageTileIndex(tileId: string): number | undefined {
  const matched = batchPageTilePattern.exec(tileId);
  return matched ? Number(matched[1]) : undefined;
}

/** Input of `read_project`: the whole document, with nothing to select. */
const readProjectInputSchema = z.object({});

/** Input of `read_catalog`. */
const readCatalogInputSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe("Case-insensitive substring matched against tile id, label, kind, and description."),
});

/** Input of `suggest_tiles`: one question about a position, discriminated by `mode`. */
const suggestTilesInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("insert"),
    ruleId: ruleIdSchema,
    side: ruleSideSchema,
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Insertion index on that side; defaults to the end of the side."),
  }),
  z.object({
    mode: z.literal("replace"),
    ruleId: ruleIdSchema,
    side: ruleSideSchema,
    position: z.number().int().min(0).describe("Index of the tile that would be replaced."),
  }),
]);

/**
 * One tile an edit names: a tile id on its own, or a factory tile id together
 * with the input it mints its tile from -- `value`, and optionally
 * `displayFormat`, for a literal factory; `name` for a variable factory. Every
 * `propose_edit` operation that names a tile takes this shape. Inside a batch,
 * the tile id `"#N.page"` names the page tile of the page the batch's own
 * command at index N creates.
 */
export const tileRunEntrySchema = z.union([
  z.string(),
  z.object({
    tileId: z.string().describe("Factory tile id from read_catalog or suggest_tiles."),
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .optional()
      .describe("Literal factory: the value the minted tile carries."),
    displayFormat: z
      .string()
      .optional()
      .describe('Literal factory: how the value reads, for example "percent" or "time_seconds".'),
    name: z.string().optional().describe("Variable factory: the name the minted variable carries."),
  }),
]);

/** One tile an edit names: a tile id, or a factory tile with its mint input. */
export type TileRunEntry = z.infer<typeof tileRunEntrySchema>;

/** The editor commands `propose_edit` applies, one per `op`. */
const editCommandBranches = [
  z.object({
    op: z.literal("addRule"),
    pageIndex: z.number().int().min(0).describe("Zero-based page index from read_project."),
  }),
  z.object({
    op: z.literal("addChildRule"),
    parentRuleId: ruleIdSchema.describe(
      "Rule id of the rule the new rule goes under, from read_project. The new rule is added after any children that rule already has, and runs each time that rule finishes its DO."
    ),
  }),
  z.object({
    op: z.literal("placeTile"),
    ruleId: ruleIdSchema,
    side: ruleSideSchema,
    tileId: tileRunEntrySchema.describe(
      "Tile to place: a tile id from read_catalog or suggest_tiles, or an object giving a factory tile's id plus what to mint."
    ),
    position: z.number().int().min(0).optional().describe("Insertion index; defaults to the end of the side."),
  }),
  z.object({
    op: z.literal("placeTiles"),
    ruleId: ruleIdSchema,
    side: ruleSideSchema,
    tileIds: z
      .array(tileRunEntrySchema)
      .min(1)
      .describe(
        "Tiles to place in order, starting at the insertion index; validated as one end state. A factory tile is given as an object carrying its mint input."
      ),
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Insertion index of the first tile; defaults to the end of the side."),
  }),
  z.object({
    op: z.literal("replaceTile"),
    ruleId: ruleIdSchema,
    side: ruleSideSchema,
    position: z.number().int().min(0).describe("Index of the tile being replaced."),
    tileId: tileRunEntrySchema.describe(
      "Tile to put there: a tile id from read_catalog or suggest_tiles, or an object giving a factory tile's id plus what to mint."
    ),
  }),
  z.object({
    op: z.literal("deleteTile"),
    ruleId: ruleIdSchema,
    side: ruleSideSchema,
    position: z.number().int().min(0).describe("Index of the tile being removed."),
  }),
  z.object({
    op: z.literal("addPage"),
    name: z
      .string()
      .min(1)
      .optional()
      .describe("What the page is called, in the person's words; omit to leave it with the default name."),
  }),
  z.object({
    op: z.literal("deleteRule"),
    ruleId: ruleIdSchema.describe(
      "Rule id of the rule to remove, from read_project. Any rules nested under it go with it."
    ),
  }),
  z.object({
    op: z.literal("deletePage"),
    pageId: pageIdSchema.describe(
      "Page id of the page to remove, from read_project. Every rule on it goes with it. The pages after it shift down one, so put deletes last in a batch that also addresses pages by pageIndex."
    ),
  }),
] as const;

/** One editor command of `propose_edit`, discriminated by `op`. */
const editCommandSchema = z.discriminatedUnion("op", editCommandBranches);

/** Input of `propose_edit`: one editor command, or a batch of them, discriminated by `op`. */
const proposeEditInputSchema = z.discriminatedUnion("op", [
  ...editCommandBranches,
  z.object({
    op: z.literal("batch"),
    commands: z
      .array(editCommandSchema)
      .min(2)
      .describe(
        'Commands to apply in order, judged as one end state; every one lands or none does. A command may name a rule an earlier command created, as "#N" for that command\'s index.'
      ),
  }),
]);

/** Input of `compile`: the whole brain, with nothing to select. */
const compileInputSchema = z.object({});

/**
 * One scripted percept of a `simulate` scenario: a value of `kind`, delivered
 * before think `at`. The kind is checked against the target's registered kinds
 * when the call runs, never here. It parses to the `ScenarioInput` shape a
 * target adapter reads.
 */
export const scenarioInputSchema = z.object({
  kind: z.string().min(1).describe("What to deliver, from the input kinds this target reads."),
  at: z.number().int().min(0).describe("Zero-based think this input is applied before."),
  value: z
    .union([z.number(), z.boolean(), z.string()])
    .describe("What the kind is set to; a level holds until another entry of the same kind changes it."),
});

/** Input of `simulate`: a scenario to stage and how many thinks to run. */
const simulateInputSchema = z.object({
  scenario: z
    .object({
      seed: z.number().int().describe("Seed for every random choice the run makes."),
      subject: z.string().describe("Population role the brain under study drives, from the scenario catalog."),
      inputs: z.array(scenarioInputSchema).optional().describe("Percepts to script into the run; omit to script none."),
    })
    .describe("Staged world description; the run is a bounded, deterministic rehearsal."),
  thinks: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .describe(
      "Number of fixed-step thinks to run; an action that takes time to play out needs many of them to finish, so size the run to what the brain does."
    ),
});

/** Every tool input schema, keyed by tool name. */
export const toolInputSchemas = {
  compile: compileInputSchema,
  propose_edit: proposeEditInputSchema,
  read_catalog: readCatalogInputSchema,
  read_project: readProjectInputSchema,
  simulate: simulateInputSchema,
  suggest_tiles: suggestTilesInputSchema,
} as const;

/** Name of one bridge tool. */
export type ToolName = keyof typeof toolInputSchemas;

/** Parsed input of the tool named `N`. */
export type ToolInput<N extends ToolName> = z.infer<(typeof toolInputSchemas)[N]>;

/** Parsed input of `propose_edit`, one editor command discriminated by `op`. */
export type ProposeEditInput = z.infer<typeof editCommandSchema>;

/** Parsed batch form of `propose_edit`: an ordered run of editor commands. */
export type ProposeEditBatchInput = Extract<z.infer<typeof proposeEditInputSchema>, { op: "batch" }>;

/** Prescriptive when-to-call guidance carried with each tool. */
const toolDescriptions: Record<ToolName, string> = {
  compile:
    "Build the whole brain and return its diagnostics. Call after a group of edits that should hold together, before claiming the brain is ready.",
  propose_edit:
    'Apply one editor command to the document. The editor validates it: an accepted edit is in the document and undoable, and a rejected edit leaves the document untouched and returns the diagnostic code that rejected it. Read the code, adjust, and propose again. This is the only way to change the brain. Any tile that leaves an expression unfinished -- an operator, an opening paren, a NOT, a parameter awaiting its value -- is rejected on its own, because the editor validates the state the edit leaves behind. Place it with the tiles that finish it in one placeTiles call: the whole run lands together or not at all. A factory tile carries no value of its own and cannot be placed by id alone: name it as an object giving its tileId plus what to mint -- a value, optionally with a displayFormat, for a literal factory, or a name for a variable factory. Every place a tile is named takes that object, so a minted value can be placed by placeTile, swapped in by replaceTile, or carried in a placeTiles run. The minted tile joins the document\'s catalog, and a rejected edit takes the minting back with the placement. Pages are how a brain holds more than one mode: addPage appends a page, gives it the name you pass, and reports the pageId it minted; the page arrives holding one empty rule you can fill straight away. Inside a batch that rule is what "#N" names for the addPage command at index N, and "#N.page" names the new page\'s own tile -- the tile you place after switch-page to send yourself there, since its id does not exist until the page does. Name every page you make something the person would recognise. A page appended this way sits one past the last page read_project reported, which is the pageIndex addRule takes for it. deleteRule removes a rule and everything nested under it; deletePage removes a page and every rule on it. Both are refused when something would be left dangling: a page another rule still switches to comes back as page_still_referenced naming those rules, so retarget or remove them first -- a batch may do both at once, since only the end state is judged -- and the only page left in the brain comes back as last_page, because a brain always has somewhere to be; empty its rules instead. Removing a page shifts every page after it down one, so put deletes last in a batch that also names pages by pageIndex. Author one command per call, narrating each as it lands; that is the default. Reach for the batch op only when a plan must land or fail as one thing, such as a refactor or a structure of several rules whose half-applied form would be worse than none: the commands apply in order, only the state they leave is judged, and one undo takes the whole plan back. States in the middle of a batch may be broken. A command that cannot apply at all stops the batch and reports its index.',
  read_catalog:
    "List the tiles available in this world with their descriptions, argument grammar, and where they may be placed. Call before planning which tiles a goal needs.",
  read_project:
    "Read the current brain: its pages, rules, and the tiles on each rule side. Call at the start of a request and again whenever the document may have changed under you.",
  simulate:
    "Run the compiled brain in a bounded rehearsal and return a summary of what happened: which rules fired, what their WHEN evaluated to, which actions dispatched, and how the state of the thing you are programming changed as it ran. Call before claiming the brain does something. A call the summary reports as pending had not finished when the run ended, so run again with more thinks before concluding anything about the brain from what did not appear.",
  suggest_tiles:
    "Ask the editor which tiles are legal at one position. Insert mode answers what may go in at a spot; call before placing a tile you are not certain of, and ask again after each placement to see what may follow. Every tile it offers can be placed there, but one that leaves the expression unfinished only lands in a placeTiles run that finishes it. Replace mode answers what may stand in for a tile already there; that is the move for a tile that is wrong rather than missing, so ask in replace mode first and then swap it with a propose_edit replaceTile.",
};

/** JSON Schema draft the tool definitions are emitted in. */
const jsonSchemaTarget = "draft-2020-12" as const;

/** One bridge tool as the model is offered it. */
export interface ToolDefinition {
  readonly name: ToolName;
  readonly description: string;
  /** JSON Schema of the tool's input, with no additional properties permitted. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** One object branch of a union input schema. */
interface SchemaBranch {
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
}

/** The property every branch fixes to a constant, which selects the branch. */
function discriminatorOf(branches: readonly SchemaBranch[]): string | undefined {
  const first = branches[0]?.properties ?? {};
  return Object.keys(first).find((name) =>
    branches.every((branch) => typeof (branch.properties?.[name] as { const?: unknown })?.const === "string")
  );
}

/** Property names `branch` accepts besides `discriminator`, in schema order. */
function branchProperties(branch: SchemaBranch, discriminator: string): string[] {
  return Object.keys(branch.properties ?? {}).filter((name) => name !== discriminator);
}

/** The discriminator value `branch` fixes. */
function branchValue(branch: SchemaBranch, discriminator: string): string {
  return (branch.properties?.[discriminator] as { const: string }).const;
}

/**
 * How `property` reads across every branch that both names and describes it: the
 * shared wording when they agree, and one `value: wording` clause per branch
 * when they differ, so a property meaning different things under different
 * discriminator values says so. `undefined` when no branch describes it.
 */
function mergedDescription(
  branches: readonly SchemaBranch[],
  discriminator: string,
  property: string
): string | undefined {
  const described = branches.flatMap((branch) => {
    const { description } = (branch.properties?.[property] as { description?: string } | undefined) ?? {};
    return description === undefined ? [] : [{ value: branchValue(branch, discriminator), description }];
  });
  if (described.length === 0) return undefined;
  const wordings = new Set(described.map((entry) => entry.description));
  if (wordings.size === 1) return described[0]!.description;
  return described.map((entry) => `${entry.value}: ${entry.description}`).join(" ");
}

/**
 * Flatten a union of object branches into one object schema: the discriminator
 * becomes an enum whose description names the properties each value takes, and
 * every other property is merged in, left optional, and described across every
 * branch that names it.
 */
function flattenUnion(branches: readonly SchemaBranch[], discriminator: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [discriminator]: {
      type: "string",
      enum: branches.map((branch) => branchValue(branch, discriminator)),
      description: branches
        .map(
          (branch) =>
            `${branchValue(branch, discriminator)} takes ${branchProperties(branch, discriminator).join(", ")}`
        )
        .join("; "),
    },
  };
  for (const branch of branches) {
    for (const name of branchProperties(branch, discriminator)) {
      if (name in properties) continue;
      const shape = branch.properties?.[name] as Record<string, unknown>;
      const description = mergedDescription(branches, discriminator, name);
      properties[name] = flattenedShape(description === undefined ? shape : { ...shape, description });
    }
  }
  return { type: "object", properties, required: [discriminator], additionalProperties: false };
}

/**
 * `shape` with every union of object branches it holds advertised flattened,
 * including one standing as an array's item schema. A shape holding no such
 * union comes back unchanged.
 */
function flattenedShape(shape: Record<string, unknown>): Record<string, unknown> {
  const { oneOf, items, ...rest } = shape as {
    oneOf?: SchemaBranch[];
    items?: Record<string, unknown>;
  };
  if (oneOf) {
    const discriminator = discriminatorOf(oneOf);
    return discriminator ? { ...rest, ...flattenUnion(oneOf, discriminator) } : shape;
  }
  return items ? { ...rest, items: flattenedShape(items) } : shape;
}

/**
 * The JSON Schema of one tool's input, as an object schema with no union at its
 * top level. A tool whose input is a discriminated union is advertised
 * flattened; the tool's own schema still validates the union when the call runs.
 */
function inputSchemaOf(name: ToolName): Readonly<Record<string, unknown>> {
  const schema = z.toJSONSchema(toolInputSchemas[name], { target: jsonSchemaTarget }) as {
    $schema?: string;
    oneOf?: SchemaBranch[];
  };
  const branches = schema.oneOf;
  if (!branches) return { ...schema, type: "object" };
  const discriminator = discriminatorOf(branches);
  if (!discriminator) throw new Error(`${name} input schema is a union with no discriminating property`);
  return { $schema: schema.$schema, ...flattenUnion(branches, discriminator) };
}

/**
 * The six bridge tools, in ascending name order. The order and the emitted
 * schemas are byte-stable across a session.
 */
export const toolDefinitions: readonly ToolDefinition[] = (Object.keys(toolInputSchemas) as ToolName[])
  .sort()
  .map((name) => ({
    name,
    description: toolDescriptions[name],
    inputSchema: inputSchemaOf(name),
  }));
