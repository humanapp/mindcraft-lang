import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AuthoringWorkspace } from "@mindcraft-lang/assistant-bridge";
import { createAuthoringWorkspace, executeToolCall } from "@mindcraft-lang/assistant-bridge";
import { createTargetAdapter, FAKE_TARGET_IDENTITY, ruleIdAt } from "@mindcraft-lang/assistant-bridge/testing";
import type {
  ConversationEntry,
  ConversationRecord,
  ConversationToolCall,
  RelayToolManifest,
} from "@mindcraft-lang/assistant-relay";
import { ConversationTurnFailureCode, RelayDeclineCode, RelayRefusalCode } from "@mindcraft-lang/assistant-relay";
import type { RelayLoopback } from "@mindcraft-lang/assistant-relay/testing";
import { createRelayLoopback } from "@mindcraft-lang/assistant-relay/testing";
import { recordFor } from "../conversation/store";
import type { ScriptedCall, ScriptedService } from "../testing/scripted-service";
import { runScriptedService } from "../testing/scripted-service";
import type { AssistantChannel } from "./channel";
import type { AssistantMachineOptions, AssistantMachineState } from "./machine";
import { AssistantMachine, AssistantStatus } from "./machine";
import { sessionStatus } from "./sessions";

/** Tiles the fake target's brains are authored from. */
const tiles = {
  sensor: "tile.sensor->sensor.fake.signal",
  actuator: "tile.actuator->actuator.fake.emit",
} as const;

/** The document every workspace in this file opens on. */
const openingDocument = createAuthoringWorkspace(createTargetAdapter(), "fake brain").brainDef.toJson();

/** Id of the one rule {@link openingDocument} holds, which the authoring turn fills in. */
const openingRuleId = ruleIdAt(
  createAuthoringWorkspace(createTargetAdapter(), "fake brain", { brainJson: openingDocument }).brainDef,
  "0/0"
);

/** The calls a first turn makes: the session catalog read, then a batch that authors a rule. */
const firstTurnCalls = {
  catalog: { name: "read_catalog", input: {} },
  authoring: [
    { name: "read_catalog", input: { filter: "signal" } },
    { name: "propose_edit", input: { op: "placeTiles", ruleId: openingRuleId, side: "when", tileIds: [tiles.sensor] } },
    { name: "propose_edit", input: { op: "placeTiles", ruleId: openingRuleId, side: "do", tileIds: [tiles.actuator] } },
  ],
} as const satisfies Record<string, ScriptedCall | readonly ScriptedCall[]>;

/** What the client declares it serves. */
const manifest: RelayToolManifest = {
  target: FAKE_TARGET_IDENTITY,
  tools: ["compile", "propose_edit", "read_catalog", "read_project", "simulate", "suggest_tiles"],
  morphology: false,
  catalogDigest: "0f3a19c2",
};

/** A workspace over the fake target, opened on {@link openingDocument}. */
function freshWorkspace(): AuthoringWorkspace {
  return createAuthoringWorkspace(createTargetAdapter(), "fake brain", { brainJson: openingDocument });
}

/** A machine under test, with the pieces a test drives it through. */
interface Harness {
  readonly machine: AssistantMachine;
  /** How many sessions the machine has asked for. */
  connects(): number;
  /** How many of the channels it was given are closed. */
  closed(): number;
  /** Resolves once every session's scripted service has played out its script. */
  readonly served: Promise<void>;
}

/** What a harness may vary about the machine it stands. */
interface HarnessOptions {
  readonly mediate?: AssistantMachineOptions["mediate"];
  /** Brains whose workspace the host cannot produce. */
  readonly workspaceless?: readonly string[];
  /** Fails every attempt to open a session. */
  readonly unreachable?: boolean;
}

/**
 * Stand a machine whose sessions are answered by scripted services: one per
 * session opened, taken from `script` by the order the sessions were opened in
 * when it varies by session.
 */
function harness(script: ScriptedService | ((at: number) => ScriptedService), options: HarnessOptions = {}): Harness {
  const workspaces = new Map<string, AuthoringWorkspace>();
  const closes: AssistantChannel[] = [];
  const services: Promise<void>[] = [];
  let connects = 0;

  const workspace = (brainId: string): AuthoringWorkspace => {
    if (options.workspaceless?.includes(brainId)) throw new Error(`no workspace for ${brainId}`);
    const held = workspaces.get(brainId);
    if (held) return held;
    const made = freshWorkspace();
    workspaces.set(brainId, made);
    return made;
  };

  const connect = (): Promise<AssistantChannel> => {
    connects++;
    if (options.unreachable) return Promise.reject(new Error("no route to the service"));
    const loopback: RelayLoopback = createRelayLoopback();
    services.push(runScriptedService(loopback, typeof script === "function" ? script(services.length) : script));
    const channel: AssistantChannel = {
      send: (message) => loopback.toolServer.send(message),
      next: () => loopback.toolServer.next(),
      close: () => {
        closes.push(channel);
        loopback.toolServer.close();
      },
    };
    return Promise.resolve(channel);
  };

  return {
    machine: new AssistantMachine({
      connect,
      manifest,
      workspace,
      ...(options.mediate ? { mediate: options.mediate } : {}),
    }),
    connects: () => connects,
    closed: () => closes.length,
    get served(): Promise<void> {
      return Promise.all(services).then(() => undefined);
    },
  };
}

/** Resolve once `machine` reaches a state `predicate` accepts. */
function until(machine: AssistantMachine, predicate: (state: AssistantMachineState) => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (predicate(machine.getState())) {
      resolve();
      return;
    }
    const unsubscribe = machine.subscribe(() => {
      if (!predicate(machine.getState())) return;
      unsubscribe();
      resolve();
    });
  });
}

/** Resolve once `machine` has no turn running on the active brain. */
function settled(machine: AssistantMachine): Promise<void> {
  return until(machine, (state) => state.status === AssistantStatus.Ready || state.status === AssistantStatus.Failed);
}

/** Resolve once `machine` has no turn running on `brainId`. */
function settledFor(machine: AssistantMachine, brainId: string): Promise<void> {
  return until(machine, (state) => {
    const status = sessionStatus(state.sessions, brainId);
    return status === AssistantStatus.Ready || status === AssistantStatus.Failed;
  });
}

/** Resolve once everything already scheduled has run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The conversation `machine` holds for `brainId`. */
function conversation(machine: AssistantMachine, brainId: string): ConversationRecord {
  return recordFor(machine.getState().store, brainId);
}

/** What `entry` reads as: what the person said, or the turn's narration segments joined. */
function saidIn(entry: ConversationEntry): string {
  if (entry.kind === "user") return entry.text;
  return entry.steps.map((step) => (step.kind === "narration" ? step.text : "")).join("");
}

/** The calls `entry` made, for a turn; empty for something the person said. */
function callsIn(entry: ConversationEntry): ConversationToolCall[] {
  if (entry.kind === "user") return [];
  return entry.steps.flatMap((step) => (step.kind === "toolCall" ? [step.call] : []));
}

/** A script whose one turn narrates and then completes. */
const oneQuietTurn: ScriptedService = {
  turns: [{ steps: [{ kind: "narration", text: "looking at it" }] }],
};

describe("opening the session", () => {
  test("opens no session until the first send", async () => {
    const stand = harness(oneQuietTurn);
    stand.machine.setActiveBrain("brain-a");

    assert.equal(stand.connects(), 0);
    assert.equal(stand.machine.getState().status, AssistantStatus.Idle);

    stand.machine.send("make it hide");
    await settled(stand.machine);

    assert.equal(stand.connects(), 1);
    await stand.served;
  });

  test("passes through connecting on the way to ready when the session is opened first", async () => {
    const stand = harness(oneQuietTurn);
    const seen: string[] = [stand.machine.getState().status];
    stand.machine.subscribe(() => {
      const status = stand.machine.getState().status;
      if (seen[seen.length - 1] !== status) seen.push(status);
    });
    stand.machine.setActiveBrain("brain-a");

    stand.machine.openSession("brain-a");
    await settled(stand.machine);
    stand.machine.send("make it hide");
    await settled(stand.machine);

    assert.deepEqual(seen, [
      AssistantStatus.Idle,
      AssistantStatus.Connecting,
      AssistantStatus.Ready,
      AssistantStatus.TurnActive,
      AssistantStatus.Ready,
    ]);
    await stand.served;
  });

  test("stands turn-active from the send that opens the session for it", async () => {
    const stand = harness(oneQuietTurn);
    stand.machine.setActiveBrain("brain-a");

    stand.machine.send("make it hide");

    assert.equal(stand.machine.getState().status, AssistantStatus.TurnActive);
    await settled(stand.machine);
    await stand.served;
  });

  test("reuses the session it already holds for a second turn", async () => {
    const stand = harness({ turns: [oneQuietTurn.turns![0]!, oneQuietTurn.turns![0]!] });
    stand.machine.setActiveBrain("brain-a");

    stand.machine.send("first");
    await settled(stand.machine);
    stand.machine.send("second");
    await settled(stand.machine);

    assert.equal(stand.connects(), 1);
    assert.equal(conversation(stand.machine, "brain-a").entries.length, 4);
    await stand.served;
  });

  test("does nothing on a send before the host has named a brain", async () => {
    const stand = harness(oneQuietTurn);

    stand.machine.send("make it hide");

    assert.equal(stand.connects(), 0);
    assert.equal(stand.machine.getState().status, AssistantStatus.Idle);
  });

  test("ignores a send while a turn is already running", async () => {
    const stand = harness({ turns: [{ steps: [{ kind: "awaitStop" }] }] });
    stand.machine.setActiveBrain("brain-a");

    stand.machine.send("first");
    await until(stand.machine, (state) => state.status === AssistantStatus.TurnActive);
    stand.machine.send("second");
    stand.machine.stop();
    await settled(stand.machine);

    const entries = conversation(stand.machine, "brain-a").entries;
    assert.deepEqual(entries[0], { kind: "user", text: "first" });
    assert.equal(entries.length, 2);
    await stand.served;
  });

  test("fails the turn that could not reach a service, and opens one on the next send", async () => {
    const unreachable = harness(oneQuietTurn, { unreachable: true });
    unreachable.machine.setActiveBrain("brain-a");

    unreachable.machine.send("make it hide");
    await settled(unreachable.machine);

    assert.equal(unreachable.machine.getState().status, AssistantStatus.Failed);
    assert.deepEqual(conversation(unreachable.machine, "brain-a").entries, [
      { kind: "user", text: "make it hide" },
      {
        kind: "assistant",
        steps: [],
        ending: { kind: "failure", code: ConversationTurnFailureCode.NotConnected },
      },
    ]);

    const reachable = harness(oneQuietTurn);
    reachable.machine.setActiveBrain("brain-a");
    reachable.machine.send("try again");
    await settled(reachable.machine);

    assert.equal(reachable.machine.getState().status, AssistantStatus.Ready);
    await reachable.served;
  });

  test("fails the turn whose handshake the service refused", async () => {
    const stand = harness({ refusal: RelayRefusalCode.TargetUnavailable });
    stand.machine.setActiveBrain("brain-a");

    stand.machine.send("make it hide");
    await settled(stand.machine);

    assert.equal(stand.machine.getState().status, AssistantStatus.Failed);
    assert.equal(stand.closed(), 1);
    await stand.served;
  });
});

describe("a session per brain", () => {
  test("opens a brain's session with no send", async () => {
    const stand = harness(oneQuietTurn);
    stand.machine.setActiveBrain("brain-a");

    stand.machine.openSession("brain-a");
    assert.equal(stand.machine.getState().status, AssistantStatus.Connecting);
    await settled(stand.machine);

    assert.equal(stand.machine.getState().status, AssistantStatus.Ready);
    assert.equal(stand.connects(), 1);
    assert.deepEqual(conversation(stand.machine, "brain-a").entries, []);
  });

  test("opens one session however often it is asked for the same brain", async () => {
    const stand = harness(oneQuietTurn);
    stand.machine.setActiveBrain("brain-a");

    stand.machine.openSession("brain-a");
    stand.machine.openSession("brain-a");
    await settled(stand.machine);
    stand.machine.openSession("brain-a");

    assert.equal(stand.connects(), 1);
  });

  test("reuses the session it holds when the brain's container closes and opens again", async () => {
    const stand = harness({ turns: [oneQuietTurn.turns![0]!, oneQuietTurn.turns![0]!] });
    stand.machine.setActiveBrain("brain-a");
    stand.machine.openSession("brain-a");
    stand.machine.send("first");
    await settled(stand.machine);

    // The container is gone and comes back on the same brain; nothing tears the
    // session down in between.
    stand.machine.setActiveBrain("brain-a");
    stand.machine.openSession("brain-a");
    stand.machine.send("second");
    await settled(stand.machine);

    assert.equal(stand.connects(), 1);
    assert.equal(stand.closed(), 0);
    assert.equal(conversation(stand.machine, "brain-a").entries.length, 4);
    await stand.served;
  });

  test("stands two brains' sessions at once, each filling only its own record", async () => {
    const stand = harness(oneQuietTurn);

    stand.machine.setActiveBrain("brain-a");
    stand.machine.send("make it hide");
    await settledFor(stand.machine, "brain-a");
    stand.machine.setActiveBrain("brain-b");
    stand.machine.send("make it seek");
    await settledFor(stand.machine, "brain-b");

    const { sessions } = stand.machine.getState();
    assert.equal(stand.connects(), 2);
    assert.equal(sessionStatus(sessions, "brain-a"), AssistantStatus.Ready);
    assert.equal(sessionStatus(sessions, "brain-b"), AssistantStatus.Ready);
    assert.deepEqual(conversation(stand.machine, "brain-a").entries[0], { kind: "user", text: "make it hide" });
    assert.deepEqual(conversation(stand.machine, "brain-b").entries[0], { kind: "user", text: "make it seek" });
    assert.equal(conversation(stand.machine, "brain-a").entries.length, 2);
    assert.equal(conversation(stand.machine, "brain-b").entries.length, 2);
    await stand.served;
  });

  test("closes every session it opened when it is stood down", async () => {
    const stand = harness(oneQuietTurn);
    stand.machine.setActiveBrain("brain-a");
    stand.machine.openSession("brain-a");
    stand.machine.openSession("brain-b");
    await settledFor(stand.machine, "brain-a");
    await settledFor(stand.machine, "brain-b");

    stand.machine.close();

    assert.equal(stand.closed(), 2);
    assert.equal(stand.machine.getState().status, AssistantStatus.Idle);
  });

  test("closes a session that arrives after it was stood down, and holds none", async () => {
    const stand = harness(oneQuietTurn);
    stand.machine.setActiveBrain("brain-a");

    stand.machine.openSession("brain-a");
    stand.machine.close();
    await flush();

    assert.equal(stand.closed(), 1);
    assert.equal(stand.machine.getState().status, AssistantStatus.Idle);
  });
});

describe("serving a turn's tool calls", () => {
  test("serves the session catalog read and an authoring batch, recording both verbatim in arrival order", async () => {
    const stand = harness({
      turns: [
        {
          steps: [
            { kind: "toolCalls", calls: [firstTurnCalls.catalog] },
            { kind: "narration", text: "writing the rule" },
            { kind: "toolCalls", calls: firstTurnCalls.authoring },
          ],
        },
      ],
    });
    stand.machine.setActiveBrain("brain-a");

    stand.machine.send("make it hide");
    await settled(stand.machine);
    await stand.served;

    const inProcess = freshWorkspace();
    const served = [];
    for (const call of [firstTurnCalls.catalog, ...firstTurnCalls.authoring]) {
      const answer = await executeToolCall(inProcess, call.name, call.input);
      served.push({
        kind: "toolCall" as const,
        call: {
          name: call.name,
          input: call.input,
          outcome: { kind: "ok", payload: JSON.parse(JSON.stringify(answer.payload)) },
        },
      });
    }

    assert.deepEqual(conversation(stand.machine, "brain-a").entries, [
      { kind: "user", text: "make it hide" },
      {
        kind: "assistant",
        steps: [served[0], { kind: "narration", text: "writing the rule" }, ...served.slice(1)],
        ending: { kind: "end", code: "complete" },
      },
    ]);
  });

  test("ends the turn stopped when the mediator declines a call, keeping the declined outcome", async () => {
    const stand = harness(
      { turns: [{ steps: [{ kind: "toolCalls", calls: [firstTurnCalls.catalog] }] }] },
      { mediate: () => ({ kind: "declined", code: RelayDeclineCode.UserStopped }) }
    );
    stand.machine.setActiveBrain("brain-a");

    stand.machine.send("make it hide");
    await settled(stand.machine);
    await stand.served;

    assert.deepEqual(conversation(stand.machine, "brain-a").entries[1], {
      kind: "assistant",
      steps: [
        {
          kind: "toolCall",
          call: {
            name: firstTurnCalls.catalog.name,
            input: firstTurnCalls.catalog.input,
            outcome: { kind: "declined", code: RelayDeclineCode.UserStopped },
          },
        },
      ],
      ending: { kind: "end", code: "stopped" },
    });
    assert.equal(stand.machine.getState().status, AssistantStatus.Ready);
  });

  test("fails the turn whose batch could not be served, and stays on the session", async () => {
    const batchTurn = { steps: [{ kind: "toolCalls", calls: [firstTurnCalls.catalog] }] } as const;
    const stand = harness({ turns: [batchTurn, batchTurn] }, { workspaceless: ["brain-a"] });
    stand.machine.setActiveBrain("brain-a");

    stand.machine.send("make it hide");
    await settled(stand.machine);

    assert.equal(stand.machine.getState().status, AssistantStatus.Ready);
    assert.deepEqual(conversation(stand.machine, "brain-a").entries[1], {
      kind: "assistant",
      steps: [],
      ending: { kind: "failure", code: ConversationTurnFailureCode.ToolServingFailed },
    });

    // The session the failed turn ran on is still the one the next turn takes.
    stand.machine.send("try again");
    await settled(stand.machine);

    assert.equal(stand.connects(), 1);
    assert.equal(stand.closed(), 0);
  });
});

describe("ending a turn", () => {
  test("ends the turn stopped when the person stops it", async () => {
    const stand = harness({ turns: [{ steps: [{ kind: "awaitStop" }] }] });
    stand.machine.setActiveBrain("brain-a");

    stand.machine.send("make it hide");
    await until(stand.machine, (state) => state.status === AssistantStatus.TurnActive);
    stand.machine.stop();
    await settled(stand.machine);
    await stand.served;

    assert.deepEqual(conversation(stand.machine, "brain-a").entries[1], {
      kind: "assistant",
      steps: [],
      ending: { kind: "end", code: "stopped" },
    });
  });

  test("stops a turn that was asked before its session had opened", async () => {
    const stand = harness({ turns: [{ steps: [{ kind: "awaitStop" }] }] });
    stand.machine.setActiveBrain("brain-a");

    stand.machine.send("make it hide");
    stand.machine.stop();
    await settled(stand.machine);
    await stand.served;

    assert.deepEqual(conversation(stand.machine, "brain-a").entries[1], {
      kind: "assistant",
      steps: [],
      ending: { kind: "end", code: "stopped" },
    });
  });

  test("records a failure and keeps what it had when the session closes mid-turn", async () => {
    const stand = harness({
      turns: [{ steps: [{ kind: "narration", text: "looking at it" }, { kind: "close" }] }],
    });
    stand.machine.setActiveBrain("brain-a");

    stand.machine.send("make it hide");
    await settled(stand.machine);
    await stand.served;

    assert.equal(stand.machine.getState().status, AssistantStatus.Failed);
    assert.deepEqual(conversation(stand.machine, "brain-a").entries, [
      { kind: "user", text: "make it hide" },
      {
        kind: "assistant",
        steps: [{ kind: "narration", text: "looking at it" }],
        ending: { kind: "failure", code: ConversationTurnFailureCode.Disconnected },
      },
    ]);
  });

  test("closes the session it opened when it is stood down", async () => {
    const stand = harness(oneQuietTurn);
    stand.machine.setActiveBrain("brain-a");

    stand.machine.send("make it hide");
    await settled(stand.machine);
    stand.machine.close();

    assert.equal(stand.closed(), 1);
    assert.equal(stand.machine.getState().status, AssistantStatus.Idle);
    await stand.served;
  });
});

describe("conversations of more than one brain", () => {
  test("keeps each brain's interleaved turns in its own record", async () => {
    const turn = (text: string) => ({ steps: [{ kind: "narration" as const, text }] });
    // One script per session, in the order the two brains open theirs.
    const scripts: ScriptedService[] = [{ turns: [turn("for a"), turn("for a again")] }, { turns: [turn("for b")] }];
    const stand = harness((at) => scripts[at]!);

    stand.machine.setActiveBrain("brain-a");
    stand.machine.send("first for a");
    await settled(stand.machine);
    stand.machine.setActiveBrain("brain-b");
    stand.machine.send("first for b");
    await settled(stand.machine);
    stand.machine.setActiveBrain("brain-a");
    stand.machine.send("second for a");
    await settled(stand.machine);
    await stand.served;

    assert.deepEqual(conversation(stand.machine, "brain-a").entries.map(saidIn), [
      "first for a",
      "for a",
      "second for a",
      "for a again",
    ]);
    assert.deepEqual(conversation(stand.machine, "brain-b").entries.map(saidIn), ["first for b", "for b"]);
  });

  test("keeps filling the brain a running turn was sent for after the active brain moves", async () => {
    let moved: () => void = () => {};
    const switched = new Promise<void>((resolve) => {
      moved = resolve;
    });
    const stand = harness(
      {
        turns: [
          {
            steps: [
              { kind: "toolCalls", calls: [firstTurnCalls.catalog] },
              { kind: "narration", text: "after the switch" },
            ],
          },
        ],
      },
      {
        mediate: async () => {
          await switched;
          return undefined;
        },
      }
    );

    stand.machine.setActiveBrain("brain-a");
    stand.machine.send("make it hide");
    stand.machine.setActiveBrain("brain-b");
    moved();
    await settledFor(stand.machine, "brain-a");
    await stand.served;

    assert.equal(stand.machine.getState().store.activeBrainId, "brain-b");
    assert.deepEqual(conversation(stand.machine, "brain-b").entries, []);
    const turn = conversation(stand.machine, "brain-a").entries[1];
    assert.ok(turn, "the turn stands in the record of the brain it was sent for");
    assert.equal(saidIn(turn), "after the switch");
    assert.equal(callsIn(turn).length, 1);
  });
});
