/**
 * The Assistant's conversation surface: the header its persona is read from,
 * the body its conversation fills, and the box an intent is typed into. The
 * intent box is disabled, and mounting the surface starts no session.
 */
export function AssistantSurface() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="h-8 w-8 shrink-0 rounded-full border border-border bg-muted" aria-hidden="true" />
        <span className="truncate text-sm font-semibold text-card-foreground">Assistant</span>
      </header>
      <div className="min-h-0 grow overflow-y-auto px-3 py-4">
        <p className="text-sm text-muted-foreground">
          Say what you want your creation to do, and we can build it together.
        </p>
      </div>
      <div className="flex shrink-0 items-end gap-2 border-t border-border p-2">
        <textarea
          className="min-h-16 grow resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          rows={2}
          disabled
          aria-label="What you want to make"
          placeholder="Type what you want to make"
        />
        <button
          type="button"
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          disabled
        >
          Send
        </button>
      </div>
    </div>
  );
}
