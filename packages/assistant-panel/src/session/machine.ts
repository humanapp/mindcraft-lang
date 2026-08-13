import type { AuthoringWorkspace } from "@mindcraft-lang/assistant-bridge";
import type { ToolCallMediator } from "@mindcraft-lang/assistant-bridge/relay";
import { serveToolCalls, unservedToolResults } from "@mindcraft-lang/assistant-bridge/relay";
import type {
  ConversationTurnEnding,
  RelayToolCallBatch,
  RelayToolManifest,
  RelayToolResultBatch,
} from "@mindcraft-lang/assistant-relay";
import {
  ASSISTANT_RELAY_PROTOCOL_VERSION,
  ConversationTurnFailureCode,
  RelayTakeoverCode,
} from "@mindcraft-lang/assistant-relay";
import type { PersonActivity } from "../app/person-activity";
import type { ConversationStore, ConversationUpdate } from "../conversation/store";
import { emptyConversationStore, recordFor, withActiveBrain, withUpdate } from "../conversation/store";
import type { AssistantChannel, AssistantConnect } from "./channel";
import type { SessionPresence } from "./presence";
import { documentPresence } from "./presence";
import type { SessionStatuses } from "./sessions";
import { AssistantStatus, emptySessions, sessionStatus, withSessionStatus } from "./sessions";

export { AssistantStatus } from "./sessions";

/**
 * Milliseconds one attempt to open a session waits for the service to accept
 * it. An attempt that runs out closes whatever socket it opened and leaves the
 * brain holding no session.
 */
export const sessionOpenTimeoutMs = 8000;

/**
 * Milliseconds the leading quiet reopen attempts wait before they are made, in
 * order. Every attempt after these waits {@link sessionReopenIntervalMs}.
 */
export const sessionReopenHeadDelaysMs: readonly number[] = [0, 1000];

/** Milliseconds between quiet reopen attempts once {@link sessionReopenHeadDelaysMs} is spent, before their spread. */
export const sessionReopenIntervalMs = 5000;

/** Milliseconds wide the spread each steady reopen delay is lengthened by, drawn fresh from [0, this). */
export const sessionReopenJitterMs = 3000;

/** What a bounded wait answers with once it has run out. */
const runOut = Symbol("session open timeout");

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
   * the active one. Throwing answers every call of that batch with an error and
   * leaves the turn running.
   */
  readonly workspace: (brainId: string) => AuthoringWorkspace;
  /** Consulted before each call in a batch once the person has not taken the turn over; every call runs when absent. */
  readonly mediate?: ToolCallMediator;
  /**
   * Where the person's own changes to a brain's document are recorded. A change
   * made since a turn started answers that turn's next batch with a takeover.
   * Absent leaves every batch to {@link mediate}.
   */
  readonly activity?: PersonActivity;
  /** Where the page stands for the quiet reopen loop; read from the document and the window when absent. */
  readonly presence?: SessionPresence;
  /** Entropy in [0, 1), drawn once per steady reopen delay for its spread; `Math.random` when absent. */
  readonly random?: () => number;
}

/** A quiet reopen loop the machine still expects for one brain. */
interface ReopenLoop {
  /** Ends the wait the loop stands in, so it can see it is no longer expected. */
  standDown: () => void;
}

/** Why one handshake stood no session up. */
type HandshakeFailure =
  /** The service answered the handshake with a refusal. */
  | "refused"
  /** The service could not be reached, answered nothing in time, or answered something other than an acceptance. */
  | "unavailable";

/** What one handshake came to. */
type HandshakeOutcome =
  | { readonly kind: "opened"; readonly channel: AssistantChannel }
  | { readonly kind: HandshakeFailure };

/**
 * One assistant session per brain, and the conversations they fill.
 *
 * A brain's session is opened by {@link AssistantMachine.openSession} or by its
 * first {@link AssistantMachine.send}, and is held until the machine is stood
 * down or the service drops it; several brains' sessions stand at once. The
 * brain being shown is dialed for quietly whenever it holds no session, until
 * one stands or the service refuses it. Each session runs one turn at a time,
 * and a turn keeps filling the record of the brain it was sent for whatever the
 * host makes active afterwards.
 */
export class AssistantMachine {
  private current: AssistantMachineState = {
    status: AssistantStatus.Idle,
    sessions: emptySessions(),
    store: emptyConversationStore(),
  };
  private readonly channels = new Map<string, AssistantChannel>();
  private readonly opening = new Map<string, Promise<AssistantChannel | undefined>>();
  /** The quiet reopen the machine still expects for a brain. */
  private readonly reopening = new Map<string, ReopenLoop>();
  /** Brains the service refused a session to, until the person asks for one again. */
  private readonly refused = new Set<string>();
  /** Brains whose running turn was asked to stop while it was still waiting for a session. */
  private readonly stopRequested = new Set<string>();
  /** What the person had changed of a brain's document when its running turn started. */
  private readonly changesAtTurnStart = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private readonly presence: SessionPresence;
  private readonly random: () => number;

  constructor(private readonly options: AssistantMachineOptions) {
    this.presence = options.presence ?? documentPresence();
    this.random = options.random ?? Math.random;
  }

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
   * brain it was sent for. The brain named takes the quiet dialing over: the one
   * it replaces stops being dialed for, and this one is dialed for while it
   * holds no session. Naming the brain already shown changes nothing and
   * notifies nobody.
   */
  setActiveBrain(brainId: string): void {
    const shown = this.current.store.activeBrainId;
    if (shown === brainId) return;
    this.commit({ store: withActiveBrain(this.current.store, brainId) });
    if (shown !== undefined) this.standDownReopen(shown);
    void this.reopen(brainId);
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
    this.changesAtTurnStart.set(brainId, this.options.activity?.mutations(brainId) ?? 0);
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
    this.askToStop(brainId);
  }

  /**
   * Ask every running turn to stop, whatever brain it was sent for and whether
   * or not that brain is the active one. A turn still waiting for its session is
   * asked as soon as the session opens. Changes nothing when no turn is running.
   */
  stopAll(): void {
    for (const [brainId, status] of this.current.sessions) {
      if (status === AssistantStatus.TurnActive) this.askToStop(brainId);
    }
  }

  /** Ask `brainId`'s turn to stop, doing nothing when no turn of its is running. */
  private askToStop(brainId: string): void {
    if (sessionStatus(this.current.sessions, brainId) !== AssistantStatus.TurnActive) return;
    const channel = this.channels.get(brainId);
    if (channel) channel.send({ type: "turn:stop" });
    else this.stopRequested.add(brainId);
  }

  /** Close every session and stand the machine down. Conversations already recorded are kept. */
  close(): void {
    for (const brainId of [...this.channels.keys()]) this.dropChannel(brainId);
    this.opening.clear();
    for (const brainId of [...this.reopening.keys()]) this.standDownReopen(brainId);
    this.refused.clear();
    this.stopRequested.clear();
    this.changesAtTurnStart.clear();
    this.commit({ sessions: emptySessions() });
  }

  /**
   * What answers `brainId`'s running turn's calls without running them: a
   * takeover for every call once the person has changed the document since the
   * turn started, and whatever the host's own mediation says otherwise.
   */
  private mediatorFor(brainId: string): ToolCallMediator | undefined {
    const { activity, mediate } = this.options;
    if (activity === undefined) return mediate;
    const changed = this.changesAtTurnStart.get(brainId) ?? 0;
    return (request) => {
      if (activity.mutations(brainId) > changed) {
        return { kind: "takeover", code: RelayTakeoverCode.DocumentEdited };
      }
      return mediate?.(request);
    };
  }

  private commit(change: Partial<Omit<AssistantMachineState, "status">>): void {
    const next = { ...this.current, ...change };
    this.current = { ...next, status: sessionStatus(next.sessions, next.store.activeBrainId) };
    for (const listener of this.listeners) listener();
  }

  private record(brainId: string, update: ConversationUpdate): void {
    this.commit({ store: withUpdate(this.current.store, brainId, update) });
  }

  /** Record every call of `asked` on `brainId`'s turn with the outcome `answered` gave it. */
  private recordBatch(brainId: string, asked: RelayToolCallBatch, answered: RelayToolResultBatch): void {
    for (const [index, request] of asked.requests.entries()) {
      const outcome = answered.results[index]!.outcome;
      this.record(brainId, { kind: "toolCall", call: { name: request.name, input: request.input, outcome } });
    }
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

  /**
   * Close `brainId`'s running turn with `ending` and stand its session back up.
   * A turn that ends holding no session leaves the brain failed and dialed for
   * quietly.
   */
  private finish(brainId: string, ending: ConversationTurnEnding): void {
    this.stopRequested.delete(brainId);
    this.changesAtTurnStart.delete(brainId);
    this.record(brainId, { kind: "ending", ending });
    const held = this.channels.has(brainId);
    this.commit({
      sessions: withSessionStatus(
        this.current.sessions,
        brainId,
        held ? AssistantStatus.Ready : AssistantStatus.Failed
      ),
    });
    if (!held) void this.reopen(brainId);
  }

  /**
   * `brainId`'s session, opening one when it holds none. Answers `undefined`
   * when no session could be opened. Callers arriving while an open is in
   * flight share that one open. A brain the service refused a session to before
   * is asked for again.
   */
  private openChannel(brainId: string): Promise<AssistantChannel | undefined> {
    // Standing the brain's quiet reopen down, so this open is the only one live.
    this.standDownReopen(brainId);
    this.refused.delete(brainId);
    const held = this.channels.get(brainId);
    if (held) return Promise.resolve(held);
    const inFlight = this.opening.get(brainId);
    if (inFlight) return inFlight;

    const attempt: Promise<AssistantChannel | undefined> = this.handshake(brainId).then((outcome) => {
      // An open the machine no longer expects belongs to a session it has been
      // stood down from.
      if (this.opening.get(brainId) !== attempt) {
        if (outcome.kind === "opened") outcome.channel.close();
        return undefined;
      }
      this.opening.delete(brainId);
      if (outcome.kind !== "opened") {
        this.giveUp(brainId, outcome.kind);
        return undefined;
      }
      this.channels.set(brainId, outcome.channel);
      this.dropWhenClosed(brainId, outcome.channel);
      this.settle(brainId, AssistantStatus.Ready);
      return outcome.channel;
    });
    this.opening.set(brainId, attempt);
    this.settle(brainId, AssistantStatus.Connecting);
    return attempt;
  }

  /**
   * Stand `brainId` at failed for a handshake that came to `failure`, and dial
   * on quietly for it. A refusal is marked instead of dialed on: nothing dials
   * for the brain again until the person asks for a session.
   */
  private giveUp(brainId: string, failure: HandshakeFailure): void {
    if (failure === "refused") this.refused.add(brainId);
    this.settle(brainId, AssistantStatus.Failed);
    void this.reopen(brainId);
  }

  /**
   * Give `brainId` up as holding no session the moment `channel` closes, and
   * open another quietly while it is the brain being shown, leaving a turn of
   * its own running to finish on its own terms. A channel the brain has already
   * given up for another leaves the machine untouched.
   */
  private dropWhenClosed(brainId: string, channel: AssistantChannel): void {
    void channel.closed.then(() => {
      if (this.channels.get(brainId) !== channel) return;
      this.channels.delete(brainId);
      this.settle(brainId, AssistantStatus.Idle);
      void this.reopen(brainId);
    });
  }

  /**
   * Whether a quiet reopen belongs to `brainId` as things stand: it is the brain
   * being shown, it holds no session and none is being opened for it, no turn of
   * its is running, the service has not refused it, and no loop of its own
   * already stands.
   */
  private wantsReopen(brainId: string): boolean {
    return (
      this.current.store.activeBrainId === brainId &&
      !this.reopening.has(brainId) &&
      !this.refused.has(brainId) &&
      !this.channels.has(brainId) &&
      !this.opening.has(brainId) &&
      sessionStatus(this.current.sessions, brainId) !== AssistantStatus.TurnActive
    );
  }

  /**
   * Open `brainId`'s session for as long as it takes and with nothing shown for
   * an attempt that lands: the attempts of {@link sessionReopenHeadDelaysMs},
   * then one every {@link sessionReopenIntervalMs} plus its spread. Does nothing
   * unless {@link wantsReopen} says the brain wants one, so one loop stands at a
   * time and it is the shown brain's. A refusal ends the loop and stands the
   * brain at failed.
   */
  private async reopen(brainId: string): Promise<void> {
    if (!this.wantsReopen(brainId)) return;
    const loop: ReopenLoop = { standDown: () => {} };
    this.reopening.set(brainId, loop);
    try {
      for (let attempt = 0; ; attempt++) {
        await this.whenDue(loop, this.reopenDelayMs(attempt));
        if (this.reopening.get(brainId) !== loop) return;
        const outcome = await this.handshake(brainId);
        if (this.reopening.get(brainId) !== loop) {
          if (outcome.kind === "opened") outcome.channel.close();
          return;
        }
        if (outcome.kind === "opened") {
          this.channels.set(brainId, outcome.channel);
          this.dropWhenClosed(brainId, outcome.channel);
          this.settle(brainId, AssistantStatus.Ready);
          return;
        }
        if (outcome.kind === "refused") {
          this.giveUp(brainId, outcome.kind);
          return;
        }
      }
    } finally {
      if (this.reopening.get(brainId) === loop) this.reopening.delete(brainId);
    }
  }

  /** End `brainId`'s quiet reopen, leaving nothing of it waiting. */
  private standDownReopen(brainId: string): void {
    this.reopening.get(brainId)?.standDown();
    this.reopening.delete(brainId);
  }

  /** How long the reopen attempt at `attempt`, counting from zero, waits before it is made. */
  private reopenDelayMs(attempt: number): number {
    return sessionReopenHeadDelaysMs[attempt] ?? sessionReopenIntervalMs + this.spreadMs();
  }

  /** A fresh draw from the spread a steady reopen delay is lengthened by. */
  private spreadMs(): number {
    return Math.floor(this.random() * sessionReopenJitterMs);
  }

  /**
   * Resolve once `loop`'s next attempt is due: `delayMs` after it was asked for
   * with the page in view, or a spread after the page comes back into view or
   * the browser comes back online. A loop stood down resolves at once, and one
   * waiting out of view waits until something above happens.
   */
  private whenDue(loop: ReopenLoop, delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const disarm = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
      };
      const due = (): void => {
        disarm();
        unsubscribe();
        loop.standDown = () => {};
        resolve();
      };
      const unsubscribe = this.presence.subscribe(() => {
        disarm();
        if (this.presence.inView()) timer = setTimeout(due, this.spreadMs());
      });
      loop.standDown = due;
      if (this.presence.inView()) timer = setTimeout(due, delayMs);
    });
  }

  /**
   * What one attempt to open `brainId`'s session came to: the session the
   * service accepted, the refusal it answered with, or unavailable when it could
   * not be reached or said nothing within {@link sessionOpenTimeoutMs}. The
   * handshake carries the conversation the brain already holds, so the service
   * can rebuild the context of a session it did not run. An attempt that runs
   * out closes the socket it opened, however late that socket arrives.
   */
  private async handshake(brainId: string): Promise<HandshakeOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const runsOut = new Promise<typeof runOut>((resolve) => {
      timer = setTimeout(() => resolve(runOut), sessionOpenTimeoutMs);
    });
    try {
      const connecting = this.options.connect();
      const connected = await Promise.race([connecting, runsOut]);
      if (connected === runOut) {
        void connecting.then(
          (late) => late.close(),
          () => {}
        );
        return { kind: "unavailable" };
      }
      const held = recordFor(this.current.store, brainId);
      connected.send({
        type: "session:connect",
        protocolVersion: ASSISTANT_RELAY_PROTOCOL_VERSION,
        manifest: this.options.manifest,
        ...(held.entries.length > 0 ? { conversation: held } : {}),
      });
      const opening = await Promise.race([connected.next(), runsOut]);
      if (opening === runOut || opening.type !== "session:accepted") {
        connected.close();
        return { kind: opening !== runOut && opening.type === "session:refused" ? "refused" : "unavailable" };
      }
      return { kind: "opened", channel: connected };
    } catch {
      return { kind: "unavailable" };
    } finally {
      clearTimeout(timer);
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
            served = await serveToolCalls(this.options.workspace(brainId), message, this.mediatorFor(brainId));
          } catch {
            const unserved = unservedToolResults(message);
            this.recordBatch(brainId, message, unserved);
            try {
              channel.send(unserved);
            } catch {
              // A session that cannot be told the batch went unserved is left
              // waiting for it, so it goes with the turn.
              this.dropChannel(brainId);
              this.finish(brainId, { kind: "failure", code: ConversationTurnFailureCode.ToolServingFailed });
              return;
            }
            break;
          }
          this.recordBatch(brainId, message, served);
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
