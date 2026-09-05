/** Where the machine stands with one brain's relay session. */
export const AssistantStatus = {
  /** The brain holds no session; opening one or sending starts it. */
  Idle: "idle",
  /** A session is being opened and no turn has been taken on it. */
  Connecting: "connecting",
  /** A session is open and no turn is running. */
  Ready: "ready",
  /** A turn is running, which may still be waiting for its session; sends wait for it to finish. */
  TurnActive: "turn_active",
  /** The session could not be opened or was lost; the next open or send tries again. */
  Failed: "failed",
} as const;

/** Where the machine stands with one brain's relay session. */
export type AssistantStatus = (typeof AssistantStatus)[keyof typeof AssistantStatus];

/** Where each brain's session stands, keyed by brain id; a brain with no session is absent. */
export type SessionStatuses = ReadonlyMap<string, AssistantStatus>;

/** Statuses holding no session at all. */
export function emptySessions(): SessionStatuses {
  return new Map();
}

/** Where `brainId`'s session stands, {@link AssistantStatus.Idle} for a brain holding none and for no brain at all. */
export function sessionStatus(sessions: SessionStatuses, brainId: string | undefined): AssistantStatus {
  return brainId === undefined ? AssistantStatus.Idle : (sessions.get(brainId) ?? AssistantStatus.Idle);
}

/** `sessions` with `brainId` standing at `status`, leaving every other brain's untouched. */
export function withSessionStatus(
  sessions: SessionStatuses,
  brainId: string,
  status: AssistantStatus
): SessionStatuses {
  const next = new Map(sessions);
  next.set(brainId, status);
  return next;
}
