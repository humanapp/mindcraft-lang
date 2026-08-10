import type { ConversationEntry, ConversationRecord, ConversationTurnEnding } from "@mindcraft-lang/assistant-relay";
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
}

/** How a turn that did not simply finish reads, and `undefined` for one that did. */
function endingNote(ending: ConversationTurnEnding | undefined): string | undefined {
  if (!ending) return undefined;
  if (ending.kind === "end") return ending.code === "complete" ? undefined : "I stopped there.";
  return "I lost my connection, so I stopped there.";
}

/** How the session's own state reads while it is not simply ready. */
function connectionNote(status: AssistantStatus): string | undefined {
  if (status === AssistantStatus.Connecting) return "Waking up...";
  if (status === AssistantStatus.Failed) return "I cannot hear you right now.";
  return undefined;
}

/** One entry of the conversation: what the person said, or one of the entity's turns. */
function EntryView({ entry }: { entry: ConversationEntry }) {
  if (entry.kind === "user") {
    return (
      <p data-assistant-entry="user" className="rounded-md bg-muted px-2 py-1.5 text-sm text-foreground">
        {entry.text}
      </p>
    );
  }
  const ending = endingNote(entry.ending);
  return (
    <div data-assistant-entry="assistant" className="flex flex-col gap-1">
      {entry.narration && (
        <p data-assistant-narration className="whitespace-pre-wrap text-sm text-card-foreground">
          {entry.narration}
        </p>
      )}
      {entry.toolCalls.map((call, at) => {
        const activity = toolActivity(call);
        return (
          <p
            key={`${call.name}-${at}`}
            data-assistant-activity={activity.kind}
            className="text-xs text-muted-foreground"
          >
            {activity.text}
          </p>
        );
      })}
      {ending && (
        <p data-assistant-ending className="text-xs text-muted-foreground">
          {ending}
        </p>
      )}
    </div>
  );
}

/**
 * The Assistant's conversation surface: the entity whose mind is open, the
 * conversation it has had with the person, and the box the next thing to do is
 * typed into. It holds no state and starts nothing; the host drives it.
 */
export function ConversationView(props: ConversationViewProps) {
  const { name, status, record, intent, onIntentChange, onSend, onStop, onRetry } = props;
  const entries = record?.entries ?? [];
  const running = status === AssistantStatus.TurnActive;
  const connection = connectionNote(status);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="h-8 w-8 shrink-0 rounded-full border border-border bg-muted" aria-hidden="true" />
        <span data-assistant-entity className="truncate text-sm font-semibold text-card-foreground">
          {name}
        </span>
      </header>
      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-3 py-4">
        {entries.length === 0 ? (
          <p data-assistant-resting className="text-sm text-muted-foreground">
            Tell me what you want me to do.
          </p>
        ) : (
          entries.map((entry, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a record only ever appends, so an entry keeps its position
            <EntryView key={`entry-${at}`} entry={entry} />
          ))
        )}
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
          aria-label="What you want me to do"
          placeholder="Tell me what to do"
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
