import type {
  ConversationEntry,
  ConversationRecord,
  ConversationTurnEnding,
  ConversationTurnStep,
} from "@mindcraft-lang/assistant-relay";
import { ConversationTurnFailureCode, RelayTurnEndCode } from "@mindcraft-lang/assistant-relay";
import { kBrainDeskFill } from "@mindcraft-lang/ui/brain-editor/brain-desk";
import { SafeMarkdown } from "@mindcraft-lang/ui/markdown/SafeMarkdown";
import { useEffect, useRef } from "react";
import type { ToolActivity } from "./conversation/activity";
import { toolActivity } from "./conversation/activity";
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

/** One thing a turn did, as the transcript lays it out. */
type LaidOutStep =
  | { readonly kind: "narration"; readonly text: string }
  | {
      readonly kind: "activity";
      readonly activity: ToolActivity;
      /** Calls the line stands for; above one, the line says how many. */
      readonly repeats: number;
    };

/** Whether two activity lines read identically, so one line can stand for both. */
function readsTheSame(one: ToolActivity, other: ToolActivity): boolean {
  return one.kind === other.kind && one.text === other.text;
}

/** `steps` in arrival order, with each run of identical activity lines folded into one line. */
function laidOut(steps: readonly ConversationTurnStep[]): LaidOutStep[] {
  const lines: LaidOutStep[] = [];
  for (const step of steps) {
    if (step.kind === "narration") {
      lines.push({ kind: "narration", text: step.text });
      continue;
    }
    const activity = toolActivity(step.call);
    const last = lines[lines.length - 1];
    if (last?.kind === "activity" && readsTheSame(last.activity, activity)) {
      lines[lines.length - 1] = { ...last, repeats: last.repeats + 1 };
      continue;
    }
    lines.push({ kind: "activity", activity, repeats: 1 });
  }
  return lines;
}

/** What a key pressed in the intent box does: send the intent, swallow the key, or fall through to typing. */
export type IntentKeyAction = "send" | "swallow" | "pass";

/**
 * Resolve a keydown in the intent box. Enter sends; Shift+Enter falls through
 * to the newline it types; an Enter mid-IME-composition belongs to the
 * composition. A plain Enter that cannot send -- a turn already running (the
 * control beside the box is Stop), or nothing but whitespace to send -- is
 * swallowed, keeping Shift+Enter the one newline gesture.
 */
export function intentKeyAction(
  key: string,
  shiftKey: boolean,
  isComposing: boolean,
  running: boolean,
  intent: string
): IntentKeyAction {
  if (key !== "Enter" || shiftKey || isComposing) return "pass";
  if (running || intent.trim().length === 0) return "swallow";
  return "send";
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

/** One thing a turn did: a run of narration, or an activity line and how many calls it stands for. */
function StepView({ step }: { step: LaidOutStep }) {
  if (step.kind === "narration") {
    return (
      <div data-assistant-bubble="entity" className={entityBubbleClasses}>
        <div data-assistant-narration className="text-sm text-card-foreground">
          <SafeMarkdown text={step.text} />
        </div>
      </div>
    );
  }
  return (
    <p
      data-assistant-activity={step.activity.kind}
      data-assistant-activity-repeats={step.repeats}
      className="text-xs text-muted-foreground"
    >
      {step.activity.text}
      {step.repeats > 1 && ` (x${step.repeats})`}
    </p>
  );
}

/** One entry of the conversation: what the person said, or one of the entity's turns. */
function EntryView({ entry, onAskAgain }: { entry: ConversationEntry; onAskAgain?: (() => void) | undefined }) {
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
  const { ending } = entry;
  const note = ending ? endingNote(ending) : undefined;
  return (
    <div data-assistant-entry="assistant" className="flex flex-col items-start gap-2">
      {laidOut(entry.steps).map((step, at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a turn only ever appends, so a step keeps its position
        <StepView key={`step-${at}`} step={step} />
      ))}
      {ending && note && (
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
      )}
    </div>
  );
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
  const { name, status, record, intent, onIntentChange, onSend, onStop, onRetry, onAskAgain } = props;
  const entries = record?.entries ?? [];
  const running = status === AssistantStatus.TurnActive;
  const connection = connectionNote(status);
  const transcript = useRef<HTMLDivElement>(null);
  const followingBottom = useRef(true);

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
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border"
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
            // biome-ignore lint/suspicious/noArrayIndexKey: a record only ever appends, so an entry keeps its position
            <EntryView key={`entry-${at}`} entry={entry} onAskAgain={onAskAgain} />
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
          data-assistant-intent
          className="min-h-16 grow resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:text-base"
          rows={2}
          value={intent}
          onChange={(event) => onIntentChange(event.target.value)}
          onKeyDown={(event) => {
            const action = intentKeyAction(event.key, event.shiftKey, event.nativeEvent.isComposing, running, intent);
            if (action === "pass") return;
            event.preventDefault();
            if (action === "send") onSend();
          }}
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
  );
}
