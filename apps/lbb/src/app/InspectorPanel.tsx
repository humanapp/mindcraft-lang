export function InspectorPanel() {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        width: 240,
        background: "rgba(24, 24, 27, 0.9)",
        border: "1px solid #3f3f46",
        borderRadius: 8,
        padding: "12px 16px",
        backdropFilter: "blur(8px)",
        zIndex: 10,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "#71717a",
          marginBottom: 8,
        }}
      >
        Inspector
      </div>
      <div style={{ fontSize: 13, color: "#52525b" }}>No selection</div>
    </div>
  );
}
