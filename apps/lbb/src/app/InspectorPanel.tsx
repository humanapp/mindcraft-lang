export function InspectorPanel() {
  return (
    <div className="absolute top-3 right-3 w-60 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-4 py-3 z-10 pointer-events-auto">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Inspector</div>
      <div className="text-sm text-zinc-600">No selection</div>
    </div>
  );
}
