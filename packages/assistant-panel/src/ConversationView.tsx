import type { ProjectTile } from "@wendoo/assistant-bridge";
import type {
  ConversationAssistantEntry,
  ConversationEntry,
  ConversationRecord,
  ConversationTurnEnding,
} from "@wendoo/assistant-relay";
import {
  ConversationTurnFailureCode,
  NarrationJudgment,
  NarrationRole,
  RelayTurnEndCode,
} from "@wendoo/assistant-relay";
import { kBrainDeskFill } from "@wendoo/ui/brain-editor/brain-desk";
import type { RenderMarkdownReference } from "@wendoo/ui/markdown/SafeMarkdown";
import { SafeMarkdown } from "@wendoo/ui/markdown/SafeMarkdown";
import { MarkdownReferenceForm } from "@wendoo/ui/markdown/safe-markdown-tokens";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import type {
  BuildBlock,
  ConversationBlock,
  LookupsBlock,
  NarrationBlock,
  ReceiptBlock,
  ReceiptRule,
  RunBlock,
  SnagBlock,
  TranscriptContext,
} from "./conversation/blocks";
import { ConversationBlockKind, conversationBlocks, transcriptContext } from "./conversation/blocks";
import type { EditSide } from "./conversation/edit-story";
import type { RunActivity, RunCell, RunEvidence, RunMarker } from "./conversation/run";
import { RunMarkerKind } from "./conversation/run";
import type { StandingState } from "./conversation/standing";
import { answerless, standingHolds, standingState } from "./conversation/standing";
import { ReferenceChip, TileChip } from "./conversation/TileChip";
import type { BrainSurface, TileLook } from "./conversation/tile-visuals";
import { BrainSurfaceProvider, unresolvedTileLook, useTileLooks } from "./conversation/tile-visuals";
import { AssistantStatus } from "./session/machine";

/** What the conversation surface shows, and the controls it hands back. */
export interface ConversationViewProps {
  /** The name of the entity whose mind is open, as the host reads it from the document. */
  name: string;
  status: AssistantStatus;
  /** The conversation shown, absent before the host has named a brain. */
  record: ConversationRecord | undefined;
  /** What stands in the intent box. */
  intent: string;
  onIntentChange: (text: string) => void;
  /** Send {@link ConversationViewProps.intent}. Called only while the box holds something and no turn runs. */
  onSend: () => void;
  /** Ask the running turn to stop. */
  onStop: () => void;
  /** Open the session again after it failed; the retry control stands only when given. */
  onRetry?: (() => void) | undefined;
  /** Put the last thing the person asked for again; a broken-off turn offers it only when given. */
  onAskAgain?: (() => void) | undefined;
  /**
   * Hand the keyboard to whatever stands around the panel, called as it leaves
   * the intent box. Answers whether anything took it; the panel lands the
   * keyboard on itself when nothing did, and whenever this is not given.
   */
  onLeaveIntent?: (() => boolean) | undefined;
  /**
   * How many times the person themselves opened the panel. Each new count lands
   * the keyboard in the intent box. Absent for an open the person did not ask
   * for, which lands the keyboard nowhere.
   */
  opensByPerson?: number | undefined;
  /**
   * The brain the tiles the entity names are drawn against. Absent while the
   * host stands none, which reads every tile by the word the conversation
   * carried, with no icon and no hue of its own.
   */
  brainSurface?: BrainSurface | undefined;
}

/** Pixels of slack at the foot of the transcript that still count as being at the bottom. */
const bottomSlackPx = 24;

/** Animation offsets of the presence mark's dots, in the order they are drawn. */
const presenceDotDelays = ["0ms", "160ms", "320ms"] as const;

/**
 * The bubble every line of the entity's own voice is drawn in: its narration,
 * its note about how a turn ended, and its presence mark.
 */
const entityBubbleClasses = "max-w-[85%] self-start rounded-[14px] rounded-bl-[4px] bg-brain-ink/8 px-3 py-2";

/** The bubble what the person asked is drawn in, standing at the side of the transcript they speak from. */
const askBubbleClasses = "max-w-[85%] self-end rounded-[14px] rounded-br-[4px] bg-primary/20 px-3 py-2";

/** The surface every block that is not the entity's own voice is drawn on. */
const cardClasses = "w-full self-start rounded-[14px] border border-border bg-brain-ink/5 px-3 py-2";

/** How much of itself a block a later one stands in the place of keeps on screen. */
const supersededClasses = "opacity-60";

/**
 * The roles the transcript draws on a card of their own. The rest of what the
 * entity says stands in its speaking bubble.
 */
const cardedRoles: readonly string[] = [
  NarrationRole.Plan,
  NarrationRole.Pivot,
  NarrationRole.Diagnosis,
  NarrationRole.Note,
];

/** What a verdict reads as on the rehearsal it judged. */
const verdictWords: Record<NarrationJudgment, string> = {
  [NarrationJudgment.Succeeded]: "it worked",
  [NarrationJudgment.Failed]: "it did not",
};

/** The tint a verdict pill reads in. */
const verdictClasses: Record<NarrationJudgment, string> = {
  [NarrationJudgment.Succeeded]: "border-brain-accent/40 bg-brain-accent/20",
  [NarrationJudgment.Failed]: "border-destructive/40 bg-destructive/20",
};

/** Pixels a rule is indented per rule it stands under. */
const ruleIndentPx = 16;

/** The gradient a rule is drawn on. */
const ruleCardFill = "linear-gradient(55deg, var(--color-brain-rule-from) 0%, var(--color-brain-rule-to) 100%)";

/**
 * How bright a stretch of a run reads, by what the brain was doing over it, as
 * the share of the panel's accent it is drawn in.
 */
const activityWeight: Record<RunActivity, number> = {
  quiet: 0.16,
  watching: 0.36,
  waiting: 0.58,
  acting: 0.92,
};

/** How tall a stretch of a run stands in the timeline, by what the brain was doing over it. */
const activityHeight: Record<RunActivity, string> = {
  quiet: "30%",
  watching: "52%",
  waiting: "72%",
  acting: "100%",
};

/** Hues the states of a run are drawn in, spread around the panel's own accent. */
const identityHues = 24;

/** The hue a state is drawn in, as degrees around the panel's accent. */
function identityTurn(identity: string | undefined): number {
  if (identity === undefined) return 0;
  const hashed = Number.parseInt(identity, 16);
  return Number.isNaN(hashed) ? 0 : (hashed % identityHues) * (360 / identityHues);
}

/** The fill one stretch of a run is drawn in: its state as a hue, what it did as a weight. */
function cellFill(cell: RunCell): string {
  return `oklch(from var(--color-brain-accent) l c calc(h + ${identityTurn(cell.identity)}) / ${activityWeight[cell.activity]})`;
}

/** The step a state is drawn at, which the same state comes back to whenever a run returns to it. */
function identityStep(identity: string | undefined): number {
  return identity === undefined ? 0 : identityTurn(identity) / (360 / identityHues);
}

/**
 * A block drawn as a card: the glance layer the reader takes in without
 * choosing to, and whatever fold stands beneath it.
 */
function Card({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <div data-assistant-card={kind} className={`${cardClasses} flex flex-col gap-1.5`}>
      {children}
    </div>
  );
}

/**
 * A disclosure the reader opens to read the long form of the block it sits in.
 * Whether it stands open is held by the element itself.
 */
function Fold({ kind, summary, children }: { kind: string; summary: string; children: ReactNode }) {
  return (
    <details data-assistant-fold={kind} className="text-xs text-muted-foreground">
      <summary className="cursor-pointer list-none pointer-coarse:min-h-11 pointer-coarse:py-2">{summary}</summary>
      <div className="mt-1 flex flex-col gap-0.5 border-border border-l pl-2">{children}</div>
    </details>
  );
}

/** How the entity judged a rehearsal, standing on the card of the run it judged. */
function VerdictPill({ judgment }: { judgment: NarrationJudgment }) {
  return (
    <span
      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-card-foreground text-xs ${verdictClasses[judgment]}`}
    >
      {verdictWords[judgment]}
    </span>
  );
}

/** The number a rule stands at on its page, drawn as a pill. */
function LinePill({ line }: { line: number }) {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brain-pill-edge bg-brain-pill font-semibold text-[11px] text-brain-pill-ink"
      aria-hidden="true"
    >
      {line}
    </span>
  );
}

/** The compact capsule opening one side of a rule, reading WHEN or DO. */
function SideCap({ side }: { side: EditSide }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-sm rounded-l-md border border-brain-capsule-edge bg-brain-capsule px-1 py-px font-semibold text-[10px] text-brain-capsule-ink tracking-wide"
      aria-hidden="true"
    >
      {side.toUpperCase()}
    </span>
  );
}

/** One side of a rule: the capsule opening it, and the tiles standing on it, wrapping as one band. */
function RuleBand({
  side,
  tiles,
  looks,
}: {
  side: EditSide;
  tiles: readonly ProjectTile[];
  looks: readonly TileLook[];
}) {
  if (tiles.length === 0) return null;
  return (
    <span data-assistant-side={side} className="flex flex-wrap items-center gap-1">
      <SideCap side={side} />
      {tiles.map((tile, at) => (
        <TileChip key={`${tile.tileId}-${at}`} tileId={tile.tileId} look={looks[at] as TileLook} />
      ))}
    </span>
  );
}

/** How a rule reads aloud, for a reader who is given the whole line at once. */
function ruleReading(when: readonly TileLook[], done: readonly TileLook[]): string {
  const side = (word: string, looks: readonly TileLook[]): string =>
    looks.length === 0 ? "" : `${word} ${looks.map((look) => look.label).join(", ")}`;
  return [side("when", when), side("do", done)].filter((part) => part.length > 0).join(", ");
}

/**
 * One rule a receipt shows, standing in as far as the rules it is nested under:
 * its number where the conversation has seen the page it stands on, and one
 * wrapping band per side, each opened by that side's capsule.
 */
function RuleSentence({ rule, context }: { rule: ReceiptRule; context: TranscriptContext }) {
  const look = useTileLooks();
  const when = rule.when.map((tile) => look(tile.tileId, "when") ?? unresolvedTileLook(tile.label));
  const done = rule.do.map((tile) => look(tile.tileId, "do") ?? unresolvedTileLook(tile.label));
  const line = context.ruleLines.get(rule.ruleId);
  return (
    <div
      data-assistant-rule={rule.ruleId}
      data-assistant-rule-depth={rule.depth}
      role="img"
      aria-label={ruleReading(when, done)}
      style={{ marginLeft: rule.depth * ruleIndentPx, background: ruleCardFill }}
      className="flex items-start gap-1.5 rounded-lg border border-border px-1.5 py-1 text-sm shadow-sm"
    >
      {line !== undefined && (
        <span className="flex h-5 items-center">
          <LinePill line={line} />
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <RuleBand side="when" tiles={rule.when} looks={when} />
        <RuleBand side="do" tiles={rule.do} looks={done} />
      </span>
    </div>
  );
}

/**
 * Draws each thing the entity names in its own words as the chip its surface
 * stands for it: a tile as its own chip, a rule as its number, a page as its
 * name. A reference to something the conversation has never seen is left to the
 * unresolved form the renderer falls back to.
 */
function useReferenceRenderer(context: TranscriptContext): RenderMarkdownReference {
  const look = useTileLooks();
  return useCallback(
    (span) => {
      if (span.form === MarkdownReferenceForm.Tile) {
        const word = context.labels.get(span.id);
        const found = look(span.id) ?? (word === undefined ? undefined : unresolvedTileLook(word));
        return found === undefined ? undefined : <TileChip tileId={span.id} look={found} />;
      }
      if (span.form === MarkdownReferenceForm.Page) {
        const page = context.pages.get(span.id);
        return page === undefined ? undefined : <ReferenceChip form={span.form} id={span.id} label={page.name} />;
      }
      const line = context.ruleLines.get(span.id);
      return line === undefined ? undefined : <ReferenceChip form={span.form} id={span.id} label={`rule ${line}`} />;
    },
    [look, context]
  );
}

/** What the edits gathered on one page left standing, and the story of how they got there. */
function ReceiptView({ block, context }: { block: ReceiptBlock; context: TranscriptContext }) {
  return (
    <Card kind={ConversationBlockKind.Receipt}>
      <div
        data-assistant-glance
        {...(block.page ? { "data-assistant-receipt-page": block.page.pageId } : {})}
        data-assistant-receipt-edits={block.story.length}
        className="flex flex-col gap-1.5"
      >
        <div className="flex items-baseline gap-2">
          <p className="grow text-card-foreground text-sm">{block.page ? block.page.name : "In your rules"}</p>
          {block.compiles && (
            <span data-assistant-compiles="ok" className="shrink-0 text-muted-foreground text-xs">
              builds [ok]
            </span>
          )}
        </div>
        {block.rules.map((rule) => (
          <RuleSentence key={rule.ruleId} rule={rule} context={context} />
        ))}
      </div>
      {block.story.length > 0 && (
        <Fold kind="edits" summary={`${block.story.length} edits -- show how`}>
          {block.story.map((row, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a story only ever appends, so a row keeps its position
            <p key={`edit-${at}`} data-assistant-step={row.op}>
              {row.text}
              {row.side && ` (${row.side})`}
            </p>
          ))}
        </Fold>
      )}
    </Card>
  );
}

/**
 * One way a proposal was refused, and how many proposals asked for that very
 * thing. The entity's own words about the refusal stand as the line the card
 * reads as where it said any; the fixed line stands where it has not.
 */
function SnagView({ block, context }: { block: SnagBlock; context: TranscriptContext }) {
  const look = useTileLooks();
  const renderReference = useReferenceRenderer(context);
  return (
    <Card kind={ConversationBlockKind.Snag}>
      <div
        data-assistant-glance
        data-assistant-snag={block.code}
        data-assistant-snag-repeats={block.repeats}
        {...(block.ruleId ? { "data-assistant-snag-rule": block.ruleId } : {})}
        {...(block.tileId ? { "data-assistant-snag-tile": block.tileId } : {})}
        {...(block.caption === undefined ? {} : { "data-assistant-snag-captioned": "true" })}
        className="flex flex-wrap items-center gap-1.5 text-card-foreground text-sm"
      >
        {block.caption === undefined ? (
          <>
            <span>Hit a wall:</span>
            {block.tileId && (
              <TileChip
                tileId={block.tileId}
                look={look(block.tileId, "do") ?? unresolvedTileLook(block.tileLabel ?? block.tileId)}
              />
            )}
            <span>does not fit there.</span>
          </>
        ) : (
          <span className="grow">
            <SafeMarkdown text={block.caption} renderReference={renderReference} />
          </span>
        )}
        {block.repeats > 1 && <span className="text-muted-foreground text-xs">{`(x${block.repeats})`}</span>}
      </div>
      <Fold kind="diagnostic" summary="what the editor said">
        {block.captionBody !== undefined && <div data-assistant-snag-caption-body>{block.captionBody}</div>}
        {Object.entries(block.params).map(([key, value]) => (
          <p key={key} data-assistant-diag-param={key}>
            {`${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`}
          </p>
        ))}
      </Fold>
    </Card>
  );
}

/** The word a page reads by at the position a run named it, and its position when nothing named it. */
function pageWord(at: number, context: TranscriptContext): string {
  return context.pageNames.get(at) ?? `page ${at}`;
}

/** What one marker on a run's timeline stands for, for the reader. */
function markerText(marker: RunMarker, context: TranscriptContext): string {
  if (marker.kind === RunMarkerKind.Page) {
    const entered = pageWord(marker.toPage ?? 0, context);
    return marker.fromPage === undefined ? `to ${entered}` : `${pageWord(marker.fromPage, context)} -> ${entered}`;
  }
  return `${marker.inputKind ?? ""} = ${marker.inputValue ?? ""}`;
}

/** The thinks one stretch of a run covers, as the fold names them. */
function cellThinks(cell: RunCell): string {
  return cell.thinks === 1 ? `think ${cell.from}` : `thinks ${cell.from}-${cell.from + cell.thinks - 1}`;
}

/** The timeline of a run: one cell per stretch of thinks doing one thing in one state. */
function RunTimeline({ run, context }: { run: RunEvidence; context: TranscriptContext }) {
  const uncovered = Math.max(run.thinks - run.covered, 0);
  return (
    <div className="flex flex-col gap-1">
      <div data-assistant-timeline={run.thinks} className="relative flex h-4 w-full items-end gap-px">
        {run.cells.map((cell) => (
          <span
            key={`cell-${cell.from}`}
            data-assistant-cell-activity={cell.activity}
            data-assistant-cell-thinks={cell.thinks}
            {...(cell.identity === undefined ? {} : { "data-assistant-cell-identity": identityStep(cell.identity) })}
            style={{ flexGrow: cell.thinks, height: activityHeight[cell.activity], background: cellFill(cell) }}
            className="min-w-0.75 rounded-xs"
          />
        ))}
        {uncovered > 0 && (
          <span
            data-assistant-timeline-cut={uncovered}
            style={{ flexGrow: uncovered }}
            className="h-full min-w-0.75 rounded-xs border border-border border-dashed"
          />
        )}
        {run.markers.map((marker, at) => (
          <span
            key={`tick-${marker.kind}-${marker.at}-${at}`}
            aria-hidden="true"
            style={{ left: `${(marker.at / Math.max(run.thinks, 1)) * 100}%` }}
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-brain-ink/70"
          />
        ))}
      </div>
      {run.markers.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground text-xs">
          {run.markers.map((marker, at) => (
            <span
              key={`marker-${marker.kind}-${marker.at}-${at}`}
              data-assistant-marker={marker.kind}
              data-assistant-marker-at={marker.at}
              {...(marker.inputKind ? { "data-assistant-marker-kind": marker.inputKind } : {})}
              {...(marker.toPage === undefined ? {} : { "data-assistant-marker-page": marker.toPage })}
            >
              {`${marker.at}: ${markerText(marker, context)}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One rehearsal a turn asked for: the line it reads as with the verdict the
 * entity gave it, what the run did, and the whole record of it under a fold. A
 * rehearsal a later one stands in the place of keeps only its line, opening to
 * the rest of itself when the reader asks.
 */
function RunView({ block, context }: { block: RunBlock; context: TranscriptContext }) {
  const { run } = block;
  const ran = run.blocked === undefined;
  const pageChanges = run.markers.filter((marker) => marker.kind === RunMarkerKind.Page).length;
  const line = (
    <div className="flex items-baseline gap-2">
      <p className="grow text-card-foreground text-sm">{ran ? "I watched it run." : "I could not run it."}</p>
      {block.judgment && <VerdictPill judgment={block.judgment} />}
      {ran && <span className="shrink-0 text-muted-foreground text-xs">{`${run.thinks} thinks`}</span>}
    </div>
  );
  const evidence = (
    <>
      {ran && <RunTimeline run={run} context={context} />}
      <div className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
        {run.asked !== undefined && run.asked !== run.thinks && (
          <span>{`stopped after ${run.thinks} of ${run.asked}`}</span>
        )}
        {pageChanges > 0 && <span>{`${pageChanges} page changes`}</span>}
        {run.covered < run.thinks && <span>the record stops part way</span>}
        {run.excludedRules.length > 0 && <span>{`${run.excludedRules.length} rules left out`}</span>}
      </div>
    </>
  );
  const record = run.cells.length > 0 && (
    <Fold kind="run" summary="open the run">
      {run.cells.map((cell) => (
        <p key={`step-${cell.from}`} data-assistant-run-step={cell.activity}>
          {`${cellThinks(cell)}: ${cell.activity}`}
        </p>
      ))}
      {run.dispatchTotals.map((total) => {
        const split = total.lastIndexOf("=");
        const call = split === -1 ? total : total.slice(0, split);
        return (
          <p
            key={`total-${total}`}
            data-assistant-dispatch={call}
            data-assistant-dispatch-count={total.slice(split + 1)}
          >
            {total}
          </p>
        );
      })}
      {run.world && (
        <p data-assistant-run-world={run.world.brainsExecuted}>
          {`${run.world.brainsExecuted} brains ran, ${run.world.initialPopulation} standing at the start and ${run.world.finalPopulation} at the end`}
        </p>
      )}
    </Fold>
  );
  const glance = {
    "data-assistant-glance": true,
    "data-assistant-run": run.runId,
    "data-assistant-run-state": ran ? "ran" : "blocked",
    ...(run.blocked === undefined ? {} : { "data-assistant-run-blocked": run.blocked }),
    ...(block.superseded ? { "data-assistant-run-superseded": "true" } : {}),
    ...(block.judgment ? { "data-assistant-run-judgment": block.judgment } : {}),
    "data-assistant-run-thinks": run.thinks,
    ...(run.asked === undefined || run.asked === run.thinks ? {} : { "data-assistant-run-asked": run.asked }),
    ...(run.covered < run.thinks ? { "data-assistant-run-truncated": "true" } : {}),
  };

  if (block.superseded) {
    return (
      <Card kind={ConversationBlockKind.Run}>
        <div {...glance} className={supersededClasses}>
          <details data-assistant-fold="earlier-run">
            <summary className="cursor-pointer list-none pointer-coarse:min-h-11 pointer-coarse:py-2">{line}</summary>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {evidence}
              {record}
            </div>
          </details>
        </div>
      </Card>
    );
  }
  return (
    <Card kind={ConversationBlockKind.Run}>
      <div {...glance} className="flex flex-col gap-1.5">
        {line}
        {evidence}
      </div>
      {record}
    </Card>
  );
}

/** One way a build came back dirty, and everything the builder reported about it. */
function BuildView({ block }: { block: BuildBlock }) {
  return (
    <Card kind={ConversationBlockKind.Build}>
      <div
        data-assistant-glance
        data-assistant-build-errors={block.errors}
        data-assistant-build-repeats={block.repeats}
        className="flex flex-wrap items-center gap-1.5 text-card-foreground text-sm"
      >
        <span>It does not build yet.</span>
        {block.repeats > 1 && <span className="text-muted-foreground text-xs">{`(x${block.repeats})`}</span>}
      </div>
      <Fold kind="build" summary="what the builder said">
        {block.diagnostics.map((diagnostic, at) => (
          <p
            // biome-ignore lint/suspicious/noArrayIndexKey: a build reports its diagnostics in a fixed order
            key={`diag-${at}`}
            data-assistant-build-diag={diagnostic.code}
            data-assistant-build-severity={diagnostic.severity}
            {...(diagnostic.ruleId ? { "data-assistant-build-rule": diagnostic.ruleId } : {})}
          >
            {`${diagnostic.severity} ${diagnostic.code}${diagnostic.ruleId ? ` in ${diagnostic.ruleId}` : ""}`}
          </p>
        ))}
      </Fold>
    </Card>
  );
}

/**
 * Where the whole conversation got to, standing above the note about how a turn
 * that left no answer ended.
 */
function GotToView({ state, context }: { state: StandingState; context: TranscriptContext }) {
  return (
    <Card kind="gotto">
      <div
        data-assistant-glance
        data-assistant-gotto-rules={state.rules}
        data-assistant-gotto-pages={state.pages.length}
        data-assistant-gotto-snags={state.snags}
        {...(state.builds === undefined ? {} : { "data-assistant-gotto-builds": state.builds ? "ok" : "no" })}
        className="flex flex-col gap-1.5"
      >
        <p className="text-card-foreground text-sm">Here is what you have so far.</p>
        {state.pages.map((page, at) => (
          <div key={`standing-${page.page?.pageId ?? at}`} className="flex flex-col gap-1">
            <p
              {...(page.page ? { "data-assistant-gotto-page": page.page.pageId } : {})}
              className="text-muted-foreground text-xs"
            >
              {page.page ? page.page.name : "In your rules"}
            </p>
            {page.rules.map((rule) => (
              <RuleSentence key={rule.ruleId} rule={rule} context={context} />
            ))}
          </div>
        ))}
        <div className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
          {state.builds !== undefined && <span>{state.builds ? "it builds" : "it does not build yet"}</span>}
          {state.lastRun && (
            <span>
              {state.lastRun.blocked === undefined
                ? `last run: ${state.lastRun.thinks} thinks`
                : "the last run did not happen"}
            </span>
          )}
          {state.snags > 0 && <span>{`${state.snags} things the editor would not take`}</span>}
        </div>
      </div>
    </Card>
  );
}

/** Everything a turn looked at without changing, gathered under one fold. */
function LookupsView({ block }: { block: LookupsBlock }) {
  const total = block.steps.reduce((count, step) => count + step.repeats, 0);
  return (
    <div data-assistant-card={ConversationBlockKind.Lookups} data-assistant-lookups={total} className="w-full">
      <Fold kind="lookups" summary={`${total} look-ups`}>
        {block.steps.map((step, at) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fold only ever appends, so a row keeps its position
          <p key={`lookup-${at}`} data-assistant-step={step.name}>
            {step.text}
            {step.repeats > 1 && ` (x${step.repeats})`}
          </p>
        ))}
      </Fold>
    </div>
  );
}

/**
 * A run of the entity's own words: the headline it opens with, and the longer
 * form under a fold where it had one. The runs that carry the shape of the work
 * -- the plan it means to follow, and what it learned -- stand on a card of
 * their own; everything else stands in the entity's speaking bubble.
 */
function NarrationCardView({ block, context }: { block: NarrationBlock; context: TranscriptContext }) {
  const renderReference = useReferenceRenderer(context);
  const carded = block.role !== undefined && cardedRoles.includes(block.role);
  const surface = carded ? `${cardClasses} flex flex-col gap-1.5` : entityBubbleClasses;
  return (
    <div
      data-assistant-card={ConversationBlockKind.Narration}
      {...(carded ? {} : { "data-assistant-bubble": "entity" })}
      {...(block.role ? { "data-assistant-narration-role": block.role } : {})}
      {...(block.judgment ? { "data-assistant-judgment": block.judgment } : {})}
      {...(block.superseded ? { "data-assistant-plan-superseded": "true" } : {})}
      {...(block.converted ? { "data-assistant-note-from": NarrationRole.Diagnosis } : {})}
      className={block.superseded ? `${surface} ${supersededClasses}` : surface}
    >
      <div data-assistant-narration className="text-card-foreground text-sm">
        <SafeMarkdown text={block.text} renderReference={renderReference} />
      </div>
      {block.body !== undefined && (
        <Fold kind="narration" summary="the long story">
          <div data-assistant-narration-body>
            <SafeMarkdown text={block.body} renderReference={renderReference} />
          </div>
        </Fold>
      )}
    </div>
  );
}

/** One block of a turn, drawn in the idiom its kind reads in. */
function BlockView({ block, context }: { block: ConversationBlock; context: TranscriptContext }) {
  switch (block.kind) {
    case ConversationBlockKind.Narration:
      return <NarrationCardView block={block} context={context} />;
    case ConversationBlockKind.Receipt:
      return <ReceiptView block={block} context={context} />;
    case ConversationBlockKind.Snag:
      return <SnagView block={block} context={context} />;
    case ConversationBlockKind.Run:
      return <RunView block={block} context={context} />;
    case ConversationBlockKind.Build:
      return <BuildView block={block} />;
    case ConversationBlockKind.Lookups:
      return <LookupsView block={block} />;
  }
}

/**
 * What a key pressed in the intent box does: send the intent, leave the box,
 * swallow the key, or fall through to typing.
 */
export type IntentKeyAction = "send" | "leave" | "swallow" | "pass";

/**
 * Resolve a keydown in the intent box. Enter sends; Shift+Enter falls through
 * to the newline it types; an Enter mid-IME-composition belongs to the
 * composition. A plain Enter that cannot send -- a turn already running (the
 * control beside the box is Stop), or nothing but whitespace to send -- is
 * swallowed, keeping Shift+Enter the one newline gesture.
 *
 * Escape leaves the box, keeping what is typed in it; an Escape
 * mid-IME-composition belongs to the composition, which cancels on it.
 */
export function intentKeyAction(
  key: string,
  shiftKey: boolean,
  isComposing: boolean,
  running: boolean,
  intent: string
): IntentKeyAction {
  if (isComposing) return "pass";
  if (key === "Escape") return "leave";
  if (key !== "Enter" || shiftKey) return "pass";
  if (running || intent.trim().length === 0) return "swallow";
  return "send";
}

/**
 * Land the keyboard in `box` for an open the person asked for, leaving what
 * stands around the box scrolled where it is. `opens` counts the opens the
 * person asked for; an absent count is an open they did not ask for, which
 * lands the keyboard nowhere.
 */
export function landKeyboardInIntent(box: HTMLTextAreaElement | null, opens: number | undefined): void {
  if (opens === undefined) return;
  box?.focus({ preventScroll: true });
}

/** How a turn cut short before the service could end it reads, by what cut it. */
function failureNote(code: ConversationTurnFailureCode): string {
  switch (code) {
    case ConversationTurnFailureCode.NotConnected:
      return "I could not hear you just then.";
    case ConversationTurnFailureCode.Disconnected:
      return "I lost my connection, so I stopped there.";
    case ConversationTurnFailureCode.ToolServingFailed:
      return "Something went wrong while I was working, so I stopped there. Ask me again?";
  }
}

/** How a turn that did not simply finish reads, and `undefined` for one that did. */
function endingNote(ending: ConversationTurnEnding): string | undefined {
  if (ending.kind === "failure") return failureNote(ending.code);
  switch (ending.code) {
    case RelayTurnEndCode.Complete:
      return undefined;
    case RelayTurnEndCode.Stopped:
      return "I stopped there.";
    case RelayTurnEndCode.Truncated:
      return "I lost my train of thought. Ask me again?";
    case RelayTurnEndCode.Failed:
      return "I could not finish that one.";
  }
}

/** Whether `ending` is the entity breaking off mid-answer, which offers to be asked again. */
function brokeOff(ending: ConversationTurnEnding): boolean {
  if (ending.kind === "failure") return ending.code === ConversationTurnFailureCode.ToolServingFailed;
  return ending.code === RelayTurnEndCode.Truncated;
}

/** How the session's own state reads while it is not simply ready. */
function connectionNote(status: AssistantStatus): string | undefined {
  if (status === AssistantStatus.Connecting) return "Waking up...";
  if (status === AssistantStatus.Failed) return "I cannot hear you right now.";
  return undefined;
}

/**
 * The entity's wordless presence, standing at the live edge of a turn that is
 * still running: the bubble its next narration will arrive in, still forming.
 */
function PresenceMark() {
  return (
    <div
      data-assistant-bubble="entity"
      data-assistant-presence
      className={`${entityBubbleClasses} flex items-center gap-1`}
      aria-hidden="true"
    >
      {presenceDotDelays.map((delay) => (
        <span
          key={delay}
          style={{ animationDelay: delay }}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none motion-reduce:opacity-50"
        />
      ))}
    </div>
  );
}

/** How many blocks of `kind` a turn laid out. */
function countKind(blocks: readonly ConversationBlock[], kind: ConversationBlockKind): number {
  return blocks.filter((block) => block.kind === kind).length;
}

/** What a folded turn says of itself: the work it left, counted by the kind of thing it is. */
function turnHeader(blocks: readonly ConversationBlock[]): string {
  const parts: string[] = [];
  const receipts = countKind(blocks, ConversationBlockKind.Receipt);
  const runs = countKind(blocks, ConversationBlockKind.Run);
  const snags = countKind(blocks, ConversationBlockKind.Snag);
  if (receipts > 0) parts.push(receipts === 1 ? "1 page changed" : `${receipts} pages changed`);
  if (runs > 0) parts.push(runs === 1 ? "1 run" : `${runs} runs`);
  if (snags > 0) parts.push(snags === 1 ? "1 snag" : `${snags} snags`);
  return parts.length === 0 ? "nothing changed" : parts.join(", ");
}

/** The note about how a turn ended, and the offer to be asked again where it broke off. */
function EndingView({
  ending,
  note,
  onAskAgain,
}: {
  ending: ConversationTurnEnding;
  note: string;
  onAskAgain?: (() => void) | undefined;
}) {
  return (
    <div className="flex w-full items-center gap-2">
      <div data-assistant-bubble="entity" className={entityBubbleClasses}>
        <p data-assistant-ending={ending.code} className="text-sm text-muted-foreground italic">
          {note}
        </p>
      </div>
      {brokeOff(ending) && onAskAgain && (
        <button
          type="button"
          data-assistant-ask-again
          onClick={onAskAgain}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-card-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * One of the entity's turns: every block it laid out, where it got to when it
 * left no answer, and how it ended. A turn a later one stands after is folded to
 * its header until the reader opens it; the newest turn always stands open.
 */
function TurnView({
  entry,
  context,
  standing,
  folded,
  onAskAgain,
}: {
  entry: ConversationAssistantEntry;
  context: TranscriptContext;
  standing: StandingState;
  folded: boolean;
  onAskAgain?: (() => void) | undefined;
}) {
  const { ending } = entry;
  const note = ending ? endingNote(ending) : undefined;
  const blocks = conversationBlocks(entry.steps, context);
  const gotTo = ending && answerless(ending) && standingHolds(standing);
  const body = (
    <>
      {blocks.map((block, at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a turn only ever appends, so a block keeps its position
        <BlockView key={`block-${at}`} block={block} context={context} />
      ))}
      {gotTo && <GotToView state={standing} context={context} />}
      {ending && note && <EndingView ending={ending} note={note} onAskAgain={onAskAgain} />}
    </>
  );

  if (!folded) {
    return (
      <div
        data-assistant-entry="assistant"
        data-assistant-turn="latest"
        className="flex w-full flex-col items-start gap-2"
      >
        {body}
      </div>
    );
  }
  return (
    <details
      data-assistant-entry="assistant"
      data-assistant-turn="folded"
      data-assistant-fold="turn"
      className="w-full"
    >
      <summary className="cursor-pointer list-none text-muted-foreground text-xs pointer-coarse:min-h-11 pointer-coarse:py-2">
        {turnHeader(blocks)}
      </summary>
      <div className="mt-2 flex w-full flex-col items-start gap-2">{body}</div>
    </details>
  );
}

/** One entry of the conversation: what the person said, or one of the entity's turns. */
function EntryView({
  entry,
  context,
  standing,
  folded,
  onAskAgain,
}: {
  entry: ConversationEntry;
  context: TranscriptContext;
  standing: StandingState;
  folded: boolean;
  onAskAgain?: (() => void) | undefined;
}) {
  if (entry.kind === "user") {
    return (
      <p
        data-assistant-entry="user"
        data-assistant-bubble="ask"
        className={`${askBubbleClasses} text-sm text-foreground`}
      >
        {entry.text}
      </p>
    );
  }
  return <TurnView entry={entry} context={context} standing={standing} folded={folded} onAskAgain={onAskAgain} />;
}

/**
 * The Assistant's conversation surface: the entity whose mind is open, the
 * conversation it has had with the person, and the box the next thing to do is
 * typed into. It holds no state and starts nothing; the host drives it.
 *
 * The transcript follows its newest content unless the person has scrolled up,
 * which holds it where they left it until they scroll back down.
 */
export function ConversationView(props: ConversationViewProps) {
  const {
    name,
    status,
    record,
    intent,
    onIntentChange,
    onSend,
    onStop,
    onRetry,
    onAskAgain,
    onLeaveIntent,
    opensByPerson,
    brainSurface,
  } = props;
  const entries = record?.entries ?? [];
  const context = useMemo(() => transcriptContext(record), [record]);
  const standing = useMemo(() => standingState(record, context), [record, context]);
  const newestTurn = entries.reduce((at, entry, index) => (entry.kind === "assistant" ? index : at), -1);
  const running = status === AssistantStatus.TurnActive;
  const connection = connectionNote(status);
  const transcript = useRef<HTMLDivElement>(null);
  const followingBottom = useRef(true);
  const surface = useRef<HTMLDivElement>(null);
  const intentBox = useRef<HTMLTextAreaElement>(null);
  const serving = useRef({ running, intent, onSend, onLeaveIntent });
  serving.current = { running, intent, onSend, onLeaveIntent };

  // The intent box's keys are served at the window, whose capture pass runs
  // ahead of the document the editor listens for Escape on. A leaving press
  // goes no further, and offers the keyboard to whatever stands around the
  // panel before the panel's own surface takes it.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const box = intentBox.current;
      if (box === null || event.target !== box) return;
      const held = serving.current;
      const action = intentKeyAction(event.key, event.shiftKey, event.isComposing, held.running, held.intent);
      if (action === "pass") return;
      event.preventDefault();
      if (action === "send") held.onSend();
      if (action === "leave") {
        event.stopPropagation();
        if (held.onLeaveIntent?.() !== true) surface.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  useEffect(() => {
    landKeyboardInIntent(intentBox.current, opensByPerson);
  }, [opensByPerson]);

  const noteScroll = (): void => {
    const element = transcript.current;
    if (!element) return;
    followingBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight <= bottomSlackPx;
  };

  useEffect(() => {
    const element = transcript.current;
    if (!element || !followingBottom.current) return;
    element.scrollTop = element.scrollHeight;
  });

  return (
    <BrainSurfaceProvider value={brainSurface}>
      <div
        ref={surface}
        tabIndex={-1}
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border outline-none"
        style={{ background: kBrainDeskFill }}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <span className="h-8 w-8 shrink-0 rounded-full border border-border bg-muted" aria-hidden="true" />
          <span data-assistant-entity className="truncate text-sm font-semibold text-card-foreground">
            {name}
          </span>
        </header>
        <div
          ref={transcript}
          onScroll={noteScroll}
          className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-3 py-4"
        >
          {entries.length === 0 ? (
            <p data-assistant-resting className="text-sm text-muted-foreground">
              Hi! What should we build?
            </p>
          ) : (
            entries.map((entry, at) => (
              <EntryView
                // biome-ignore lint/suspicious/noArrayIndexKey: a record only ever appends, so an entry keeps its position
                key={`entry-${at}`}
                entry={entry}
                context={context}
                standing={standing}
                folded={at !== newestTurn}
                onAskAgain={onAskAgain}
              />
            ))
          )}
          {running && <PresenceMark />}
        </div>
        {connection && (
          <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5">
            <p data-assistant-connection={status} className="grow text-xs text-muted-foreground">
              {connection}
            </p>
            {onRetry && (
              <button
                type="button"
                data-assistant-retry
                onClick={onRetry}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-card-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              >
                Try again
              </button>
            )}
          </div>
        )}
        <div className="flex shrink-0 items-end gap-2 border-t border-border p-2">
          <textarea
            ref={intentBox}
            data-assistant-intent
            className="min-h-16 grow resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:text-base"
            rows={2}
            value={intent}
            onChange={(event) => onIntentChange(event.target.value)}
            aria-label="What we should build"
            placeholder="Tell me your idea..."
          />
          {running ? (
            <button
              type="button"
              data-assistant-stop
              onClick={onStop}
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-card-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              data-assistant-send
              onClick={onSend}
              disabled={intent.trim().length === 0}
              className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </BrainSurfaceProvider>
  );
}
