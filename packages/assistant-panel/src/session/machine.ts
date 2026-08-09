import type { AuthoringWorkspace } from "@mindcraft-lang/assistant-bridge";
import type { ToolCallMediator } from "@mindcraft-lang/assistant-bridge/relay";
import { serveToolCalls } from "@mindcraft-lang/assistant-bridge/relay";
import type { ConversationTurnEnding, RelayToolManifest, RelayToolResultBatch } from "@mindcraft-lang/assistant-relay";
import { ASSISTANT_RELAY_PROTOCOL_VERSION, ConversationTurnFailureCode } from "@mindcraft-lang/assistant-relay";
import type { ConversationStore, ConversationUpdate } from "../conversation/store";
import { emptyConversationStore, withActiveBrain, withUpdate } from "../conversation/store";
import type { AssistantChannel, AssistantConnect } from "./channel";

/** Where the machine stands with its relay session. */
export const AssistantStatus = {
  /** No session is open; the next send opens one. */
  Idle: "idle",
  /** A session is being opened for a send that has already been taken. */
  Connecting: "connecting",
  /** A session is open and no turn is running. */
  Ready: "ready",
  /** A turn is running; sends are ignored until it finishes. */
  TurnActive: "turn_active",
  /** The session could not be opened or was lost; the next send tries again. */
  Failed: "failed",
} as const;

/** Where the machine stands with its relay session. */
export type AssistantStatus = (typeof AssistantStatus)[keyof typeof AssistantStatus];

/** What the machine exposes to whatever renders it. */
export interface AssistantMachineState {
  readonly status: AssistantStatus;
  readonly store: ConversationStore;
}

/** What one machine is built over. */
export interface AssistantMachineOptions {
  /** Opens the machine's relay session. Called on the first send, never at construction. */
  readonly connect: AssistantConnect;
  /** What the handshake declares this client serves. */
  readonly manifest: RelayToolManifest;
  /**
   * The live workspace a brain's tool calls run against. Called once per served
   * batch with the brain the running turn belongs to, which is not necessarily
   * the active one.
   */
  readonly workspace: (brainId: string) => AuthoringWorkspace;
  /** Consulted before each call in a batch; every call runs when absent. */
  readonly mediate?: ToolCallMediator;
}

/**
 * One assistant session and the conversations it fills.
 *
 * The machine holds one relay session, opened lazily on the first
 * {@link AssistantMachine.send}, and one conversation per brain. A turn belongs
 * to the brain that was active when it was sent and keeps filling that brain's
 * record whatever the host makes active afterwards. One turn runs at a time.
 */
export class AssistantMachine {
  private current: AssistantMachineState = { status: AssistantStatus.Idle, store: emptyConversationStore() };
  private channel: AssistantChannel | undefined;
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

  /** Show `brainId`'s conversation. A turn already running keeps filling the brain it was sent for. */
  setActiveBrain(brainId: string): void {
    this.commit({ store: withActiveBrain(this.current.store, brainId) });
  }

  /**
   * Start a turn on the active brain from what the person said. Does nothing
   * while a turn is running, while a session is being opened, or before the
   * host has named an active brain.
   */
  send(text: string): void {
    const { status, store } = this.current;
    if (status === AssistantStatus.Connecting || status === AssistantStatus.TurnActive) return;
    const brainId = store.activeBrainId;
    if (brainId === undefined) return;
    this.commit({
      status: this.channel ? AssistantStatus.TurnActive : AssistantStatus.Connecting,
      store: withUpdate(store, brainId, { kind: "user", text }),
    });
    void this.runTurn(brainId, text);
  }

  /** Ask the running turn to stop. Does nothing when no turn is running. */
  stop(): void {
    if (this.current.status !== AssistantStatus.TurnActive) return;
    this.channel?.send({ type: "turn:stop" });
  }

  /** Close the session and stand the machine down. Conversations already recorded are kept. */
  close(): void {
    this.dropChannel();
    this.commit({ status: AssistantStatus.Idle });
  }

  private commit(change: Partial<AssistantMachineState>): void {
    this.current = { ...this.current, ...change };
    for (const listener of this.listeners) listener();
  }

  private record(brainId: string, update: ConversationUpdate): void {
    this.commit({ store: withUpdate(this.current.store, brainId, update) });
  }

  private dropChannel(): void {
    this.channel?.close();
    this.channel = undefined;
  }

  /** Close `brainId`'s running turn with `ending` and stand the machine back up. */
  private finish(brainId: string, ending: ConversationTurnEnding): void {
    this.record(brainId, { kind: "ending", ending });
    this.commit({ status: this.channel ? AssistantStatus.Ready : AssistantStatus.Failed });
  }

  /**
   * The machine's session, opening one first when it holds none. Answers
   * `undefined` when no session could be opened.
   */
  private async openSession(): Promise<AssistantChannel | undefined> {
    if (this.channel) return this.channel;
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
      this.channel = channel;
      return channel;
    } catch {
      return undefined;
    }
  }

  /** Run one turn end to end on `brainId`'s record. */
  private async runTurn(brainId: string, text: string): Promise<void> {
    const channel = await this.openSession();
    if (channel === undefined) {
      this.finish(brainId, { kind: "failure", code: ConversationTurnFailureCode.NotConnected });
      return;
    }

    this.commit({ status: AssistantStatus.TurnActive });
    try {
      channel.send({ type: "session:userMessage", text });
      await this.follow(brainId, channel);
    } catch {
      this.dropChannel();
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
