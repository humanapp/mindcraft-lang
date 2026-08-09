import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AuthoringWorkspace } from "@mindcraft-lang/assistant-bridge";
import { createAuthoringWorkspace, executeToolCall } from "@mindcraft-lang/assistant-bridge";
import { createTargetAdapter, FAKE_TARGET_IDENTITY } from "@mindcraft-lang/assistant-bridge/testing";
import type { ConversationRecord, RelayToolManifest } from "@mindcraft-lang/assistant-relay";
import { ConversationTurnFailureCode, RelayDeclineCode, RelayRefusalCode } from "@mindcraft-lang/assistant-relay";
import type { RelayLoopback } from "@mindcraft-lang/assistant-relay/testing";
import { createRelayLoopback } from "@mindcraft-lang/assistant-relay/testing";
import { recordFor } from "../conversation/store";
import type { AssistantChannel } from "./channel";
import type { AssistantMachineOptions, AssistantMachineState } from "./machine";
import { AssistantMachine, AssistantStatus } from "./machine";
import type { ScriptedCall, ScriptedService } from "./test-only-scripted-service";
import { runScriptedService } from "./test-only-scripted-service";

/** Tiles the fake target's brains are authored from. */
const tiles = {
  sensor: "tile.sensor->sensor.fake.signal",
  actuator: "tile.actuator->actuator.fake.emit",
} as const;

/** The calls a first turn makes: the session catalog read, then a batch that authors a rule. */
const firstTurnCalls = {
  catalog: { name: "read_catalog", input: {} },
  authoring: [
    { name: "read_catalog", input: { filter: "signal" } },
    { name: "propose_edit", input: { op: "placeTiles", ruleId: "0/0", side: "when", tileIds: [tiles.sensor] } },
    { name: "propose_edit", input: { op: "placeTiles", ruleId: "0/0", side: "do", tileIds: [tiles.actuator] } },
  ],
} as const satisfies Record<string, ScriptedCall | readonly ScriptedCall[]>;

/** What the client declares it serves. */
const manifest: RelayToolManifest = {
  target: FAKE_TARGET_IDENTITY,
  tools: ["compile", "propose_edit", "read_catalog", "read_project", "simulate", "suggest_tiles"],
  morphology: false,
  catalogDigest: "0f3a19c2",
};

/** The document every workspace in this file opens on. */
const openingDocument = createAuthoringWorkspace(createTargetAdapter(), "fake brain").brainDef.toJson();

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
  /** Resolves once the scripted service has played out its script. */
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

/** Stand a machine over a loopback the scripted `script` answers. */
function harness(script: ScriptedService, options: HarnessOptions = {}): Harness {
  const loopback: RelayLoopback = createRelayLoopback();
  const workspaces = new Map<string, AuthoringWorkspace>();
  const closes: AssistantChannel[] = [];
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
    served: runScriptedService(loopback, script),
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

/** Resolve once `machine` has no turn running. */
function settled(machine: AssistantMachine): Promise<void> {
  return until(machine, (state) => state.status === AssistantStatus.Ready || state.status === AssistantStatus.Failed);
}

/** The conversation `machine` holds for `brainId`. */
function conversation(machine: AssistantMachine, brainId: string): ConversationRecord {
  return recordFor(machine.getState().store, brainId);
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

  test("passes through connecting and turn-active on the way back to ready", async () => {
    const stand = harness(oneQuietTurn);
    const seen: string[] = [stand.machine.getState().status];
    stand.machine.subscribe(() => {
      const status = stand.machine.getState().status;
      if (seen[seen.length - 1] !== status) seen.push(status);
    });
    stand.machine.setActiveBrain("brain-a");

    stand.machine.send("make it hide");
    await settled(stand.machine);

    assert.deepEqual(seen, [
      AssistantStatus.Idle,
      AssistantStatus.Connecting,
      AssistantStatus.TurnActive,
      AssistantStatus.Ready,
    ]);
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
        narration: "",
        toolCalls: [],
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

describe("serving a turn's tool calls", () => {
  test("serves the session catalog read and an authoring batch, and records both verbatim", async () => {
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
    const expected = [];
    for (const call of [firstTurnCalls.catalog, ...firstTurnCalls.authoring]) {
      const served = await executeToolCall(inProcess, call.name, call.input);
      expected.push({
        name: call.name,
        input: call.input,
        outcome: { kind: "ok", payload: JSON.parse(JSON.stringify(served.payload)) },
      });
    }

    assert.deepEqual(conversation(stand.machine, "brain-a").entries, [
      { kind: "user", text: "make it hide" },
      {
        kind: "assistant",
        narration: "writing the rule",
        toolCalls: expected,
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
      narration: "",
      toolCalls: [
        {
          name: firstTurnCalls.catalog.name,
          input: firstTurnCalls.catalog.input,
          outcome: { kind: "declined", code: RelayDeclineCode.UserStopped },
        },
      ],
      ending: { kind: "end", code: "stopped" },
    });
    assert.equal(stand.machine.getState().status, AssistantStatus.Ready);
  });

  test("fails the turn whose batch could not be served, and stays on the session", async () => {
    const stand = harness(
      { turns: [{ steps: [{ kind: "toolCalls", calls: [firstTurnCalls.catalog] }] }] },
      {
        workspaceless: ["brain-a"],
      }
    );
    stand.machine.setActiveBrain("brain-a");

    stand.machine.send("make it hide");
    await settled(stand.machine);

    assert.equal(stand.machine.getState().status, AssistantStatus.Ready);
    assert.deepEqual(conversation(stand.machine, "brain-a").entries[1], {
      kind: "assistant",
      narration: "",
      toolCalls: [],
      ending: { kind: "failure", code: ConversationTurnFailureCode.ToolServingFailed },
    });
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
      narration: "",
      toolCalls: [],
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
        narration: "looking at it",
        toolCalls: [],
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
    const stand = harness({ turns: [turn("for a"), turn("for b"), turn("for a again")] });

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

    assert.deepEqual(
      conversation(stand.machine, "brain-a").entries.map((entry) =>
        entry.kind === "user" ? entry.text : entry.narration
      ),
      ["first for a", "for a", "second for a", "for a again"]
    );
    assert.deepEqual(
      conversation(stand.machine, "brain-b").entries.map((entry) =>
        entry.kind === "user" ? entry.text : entry.narration
      ),
      ["first for b", "for b"]
    );
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
    await until(stand.machine, (state) => state.status === AssistantStatus.TurnActive);
    stand.machine.setActiveBrain("brain-b");
    moved();
    await settled(stand.machine);
    await stand.served;

    assert.equal(stand.machine.getState().store.activeBrainId, "brain-b");
    assert.deepEqual(conversation(stand.machine, "brain-b").entries, []);
    const turn = conversation(stand.machine, "brain-a").entries[1];
    assert.equal(turn?.kind === "assistant" && turn.narration, "after the switch");
    assert.equal(turn?.kind === "assistant" && turn.toolCalls.length, 1);
  });
});
