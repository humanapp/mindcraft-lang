import type { AuthoringWorkspace } from "@mindcraft-lang/assistant-bridge";
import type { ToolCallMediator } from "@mindcraft-lang/assistant-bridge/relay";
import { serveToolCalls } from "@mindcraft-lang/assistant-bridge/relay";
import type { ConversationTurnEnding, RelayToolManifest, RelayToolResultBatch } from "@mindcraft-lang/assistant-relay";
import { ASSISTANT_RELAY_PROTOCOL_VERSION, ConversationTurnFailureCode } from "@mindcraft-lang/assistant-relay";
import type { ConversationStore, ConversationUpdate } from "../conversation/store";
import { emptyConversationStore, withActiveBrain, withUpdate } from "../conversation/store";
import type { AssistantChannel, AssistantConnect } from "./channel";
import type { SessionStatuses } from "./sessions";
import { AssistantStatus, emptySessions, sessionStatus, withSessionStatus } from "./sessions";

export { AssistantStatus } from "./sessions";

/** What the machine exposes to whatever renders it. */
export interface AssistantMachineState {
  /** Where the active brain's session stands; idle while the host has named no brain. */
  readonly status: AssistantStatus;
  /** Where every brain's session stands. */
  readonly sessions: SessionStatuses;
  readonly store: ConversationStore;
}

/** What one machine is built over. */
export interface AssistantMachineOptions {
  /** Opens one relay session. Called once per brain that opens one, never at construction. */
  readonly connect: AssistantConnect;
  /** What the handshake declares this client serves. */
  readonly manifest: RelayToolManifest;
  /**
   * The live workspace a brain's tool calls run against. Called once per served
   * batch with the brain the running turn belongs to, which is not necessarily
   * the active one. Throwing fails that batch's turn and keeps the session.
   */
  readonly workspace: (brainId: string) => AuthoringWorkspace;
  /** Consulted before each call in a batch; every call runs when absent. */
  readonly mediate?: ToolCallMediator;
}

/**
 * One assistant session per brain, and the conversations they fill.
 *
 * A brain's session is opened by {@link AssistantMachine.openSession} or by its
 * first {@link AssistantMachine.send}, and is held until the machine is stood
 * down or the service drops it; several brains' sessions stand at once. Each
 * runs one turn at a time, and a turn keeps filling the record of the brain it
 * was sent for whatever the host makes active afterwards.
 */
export class AssistantMachine {
  private current: AssistantMachineState = {
    status: AssistantStatus.Idle,
    sessions: emptySessions(),
    store: emptyConversationStore(),
  };
  private readonly channels = new Map<string, AssistantChannel>();
  private readonly opening = new Map<string, Promise<AssistantChannel | undefined>>();
  /** Brains whose running turn was asked to stop while it was still waiting for a session. */
  private readonly stopRequested = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: AssistantMachineOptions) {}

  /** The machine's state; a new object exactly when something observable changed. */
  readonly getState = (): AssistantMachineState => this.current;

  /** Call `listener` whenever {@link getState} would answer with something new. Returns the unsubscribe. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Show `brainId`'s conversation. A turn already running keeps filling the
   * brain it was sent for. Naming the brain already shown changes nothing and
   * notifies nobody.
   */
  setActiveBrain(brainId: string): void {
    if (this.current.store.activeBrainId === brainId) return;
    this.commit({ store: withActiveBrain(this.current.store, brainId) });
  }

  /**
   * Open `brainId`'s session now, so its first send finds one standing. Does
   * nothing when the brain already holds a session or is opening one.
   */
  openSession(brainId: string): void {
    void this.openChannel(brainId);
  }

  /**
   * Start a turn on the active brain from what the person said. Does nothing
   * while that brain's turn is running or before the host has named an active
   * brain. A brain holding no session opens one for the turn.
   */
  send(text: string): void {
    const { sessions, store } = this.current;
    const brainId = store.activeBrainId;
    if (brainId === undefined) return;
    if (sessionStatus(sessions, brainId) === AssistantStatus.TurnActive) return;
    this.commit({
      sessions: withSessionStatus(sessions, brainId, AssistantStatus.TurnActive),
      store: withUpdate(store, brainId, { kind: "user", text }),
    });
    void this.runTurn(brainId, text);
  }

  /**
   * Ask the active brain's running turn to stop. Does nothing when no turn of
   * its is running. A turn still waiting for its session is asked as soon as
   * the session opens.
   */
  stop(): void {
    const brainId = this.current.store.activeBrainId;
    if (brainId === undefined) return;
    if (sessionStatus(this.current.sessions, brainId) !== AssistantStatus.TurnActive) return;
    const channel = this.channels.get(brainId);
    if (channel) channel.send({ type: "turn:stop" });
    else this.stopRequested.add(brainId);
  }

  /** Close every session and stand the machine down. Conversations already recorded are kept. */
  close(): void {
    for (const brainId of [...this.channels.keys()]) this.dropChannel(brainId);
    this.opening.clear();
    this.stopRequested.clear();
    this.commit({ sessions: emptySessions() });
  }

  private commit(change: Partial<Omit<AssistantMachineState, "status">>): void {
    const next = { ...this.current, ...change };
    this.current = { ...next, status: sessionStatus(next.sessions, next.store.activeBrainId) };
    for (const listener of this.listeners) listener();
  }

  private record(brainId: string, update: ConversationUpdate): void {
    this.commit({ store: withUpdate(this.current.store, brainId, update) });
  }

  private dropChannel(brainId: string): void {
    this.channels.get(brainId)?.close();
    this.channels.delete(brainId);
  }

  /** Stand `brainId`'s session at `status`, leaving a turn of its own running untouched. */
  private settle(brainId: string, status: AssistantStatus): void {
    if (sessionStatus(this.current.sessions, brainId) === AssistantStatus.TurnActive) return;
    this.commit({ sessions: withSessionStatus(this.current.sessions, brainId, status) });
  }

  /** Close `brainId`'s running turn with `ending` and stand its session back up. */
  private finish(brainId: string, ending: ConversationTurnEnding): void {
    this.stopRequested.delete(brainId);
    this.record(brainId, { kind: "ending", ending });
    this.commit({
      sessions: withSessionStatus(
        this.current.sessions,
        brainId,
        this.channels.has(brainId) ? AssistantStatus.Ready : AssistantStatus.Failed
      ),
    });
  }

  /**
   * `brainId`'s session, opening one when it holds none. Answers `undefined`
   * when no session could be opened. Callers arriving while an open is in
   * flight share that one open.
   */
  private openChannel(brainId: string): Promise<AssistantChannel | undefined> {
    const held = this.channels.get(brainId);
    if (held) return Promise.resolve(held);
    const inFlight = this.opening.get(brainId);
    if (inFlight) return inFlight;

    const attempt: Promise<AssistantChannel | undefined> = this.handshake().then((channel) => {
      // An open the machine no longer expects belongs to a session it has been
      // stood down from.
      if (this.opening.get(brainId) !== attempt) {
        channel?.close();
        return undefined;
      }
      this.opening.delete(brainId);
      if (channel) this.channels.set(brainId, channel);
      this.settle(brainId, channel ? AssistantStatus.Ready : AssistantStatus.Failed);
      return channel;
    });
    this.opening.set(brainId, attempt);
    this.settle(brainId, AssistantStatus.Connecting);
    return attempt;
  }

  /** One accepted relay session, or `undefined` when the service refused it or could not be reached. */
  private async handshake(): Promise<AssistantChannel | undefined> {
    try {
      const channel = await this.options.connect();
      channel.send({
        type: "session:connect",
        protocolVersion: ASSISTANT_RELAY_PROTOCOL_VERSION,
        manifest: this.options.manifest,
      });
      const opening = await channel.next();
      if (opening.type !== "session:accepted") {
        channel.close();
        return undefined;
      }
      return channel;
    } catch {
      return undefined;
    }
  }

  /** Run one turn end to end on `brainId`'s record. */
  private async runTurn(brainId: string, text: string): Promise<void> {
    const channel = await this.openChannel(brainId);
    if (channel === undefined) {
      this.finish(brainId, { kind: "failure", code: ConversationTurnFailureCode.NotConnected });
      return;
    }

    try {
      channel.send({ type: "session:userMessage", text });
      if (this.stopRequested.delete(brainId)) channel.send({ type: "turn:stop" });
      await this.follow(brainId, channel);
    } catch {
      this.dropChannel(brainId);
      this.finish(brainId, { kind: "failure", code: ConversationTurnFailureCode.Disconnected });
    }
  }

  /**
   * Read the turn's messages and record them until it finishes. Throws whatever
   * the channel throws once the session is gone.
   */
  private async follow(brainId: string, channel: AssistantChannel): Promise<void> {
    for (;;) {
      const message = await channel.next();
      switch (message.type) {
        case "turn:narration":
          this.record(brainId, { kind: "narration", text: message.text });
          break;
        case "turn:toolCalls": {
          let served: RelayToolResultBatch;
          try {
            served = await serveToolCalls(this.options.workspace(brainId), message, this.options.mediate);
          } catch {
            this.finish(brainId, { kind: "failure", code: ConversationTurnFailureCode.ToolServingFailed });
            return;
          }
          for (const [index, request] of message.requests.entries()) {
            const outcome = served.results[index]!.outcome;
            this.record(brainId, { kind: "toolCall", call: { name: request.name, input: request.input, outcome } });
          }
          channel.send(served);
          break;
        }
        case "turn:end":
          this.finish(brainId, { kind: "end", code: message.code });
          return;
        case "turn:start":
        case "session:accepted":
        case "session:refused":
          break;
      }
    }
  }
}
