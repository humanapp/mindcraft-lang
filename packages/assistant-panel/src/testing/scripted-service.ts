import type { RelayDownstreamMessage, RelayRefusalCode, RelayUpstreamMessage } from "@wendoo/assistant-relay";
import { ASSISTANT_RELAY_PROTOCOL_VERSION } from "@wendoo/assistant-relay";
import type { RelayLoopback, RelayLoopbackEnd } from "@wendoo/assistant-relay/testing";
import { RelayLoopbackClosed } from "@wendoo/assistant-relay/testing";

/** One tool call a scripted step asks the client for. */
export interface ScriptedCall {
  readonly name: string;
  readonly input: unknown;
}

/** One thing the scripted service does inside a turn. */
export type ScriptedStep =
  | { readonly kind: "narration"; readonly text: string }
  | { readonly kind: "toolCalls"; readonly calls: readonly ScriptedCall[] }
  | { readonly kind: "awaitStop" }
  | { readonly kind: "close" };

/** One turn the scripted service plays for one user message. */
export interface ScriptedTurn {
  readonly steps: readonly ScriptedStep[];
}

/** What the scripted service does with the session it is offered. */
export interface ScriptedService {
  /** When set, the handshake is refused with this code and no turn is played. */
  readonly refusal?: RelayRefusalCode;
  /** When set, the handshake is read and never answered, and the session is left standing open. */
  readonly silent?: boolean;
  /** When set, the session is closed as soon as the handshake has been accepted, before any turn. */
  readonly closesWhenIdle?: boolean;
  readonly turns?: readonly ScriptedTurn[];
}

/** Session id the scripted service accepts every handshake with. */
const scriptedSessionId = "scripted-session";

/** Milliseconds a scripted request allows for its answer. */
const timeoutMs = 15000;

/** The service's end of a loopback. */
type ServiceEnd = RelayLoopbackEnd<RelayDownstreamMessage, RelayUpstreamMessage>;

/** How playing one turn left the session. */
type TurnResult = "played" | "stopped" | "closed";

/** Play one scripted turn, from `turn:start` to whatever closes the turn. */
async function playTurn(service: ServiceEnd, turn: ScriptedTurn, at: number): Promise<TurnResult> {
  service.send({ type: "turn:start" });
  for (const [index, step] of turn.steps.entries()) {
    switch (step.kind) {
      case "narration":
        service.send({ type: "turn:narration", text: step.text });
        break;
      case "toolCalls": {
        service.send({
          type: "turn:toolCalls",
          requests: step.calls.map((call, position) => ({
            requestId: `turn-${at}-step-${index}-call-${position}`,
            name: call.name,
            input: call.input,
            timeoutMs,
          })),
        });
        const answered = await service.next();
        if (answered.type !== "turn:toolResults") {
          service.send({ type: "turn:end", code: "stopped" });
          return "stopped";
        }
        if (answered.results.some((result) => result.outcome.kind !== "ok")) {
          service.send({ type: "turn:end", code: "stopped" });
          return "stopped";
        }
        break;
      }
      case "awaitStop":
        await service.next();
        service.send({ type: "turn:end", code: "stopped" });
        return "stopped";
      case "close":
        service.close();
        return "closed";
    }
  }
  service.send({ type: "turn:end", code: "complete" });
  return "played";
}

/**
 * Answer the client's session from the service's end of `loopback`, playing one
 * scripted turn per user message. Resolves once the script runs out or either
 * end closes the pairing; rejects on anything else the loopback throws.
 */
export async function runScriptedService(loopback: RelayLoopback, script: ScriptedService): Promise<void> {
  const service = loopback.service;
  const turns = script.turns ?? [];
  let played = 0;
  try {
    for (;;) {
      const message = await service.next();
      if (message.type === "session:connect") {
        if (script.silent) return;
        if (script.refusal) {
          service.send({
            type: "session:refused",
            code: script.refusal,
            protocolVersion: ASSISTANT_RELAY_PROTOCOL_VERSION,
          });
          return;
        }
        service.send({ type: "session:accepted", sessionId: scriptedSessionId });
        if (script.closesWhenIdle) {
          service.close();
          return;
        }
        continue;
      }
      if (message.type !== "session:userMessage") continue;
      const turn = turns[played];
      if (!turn) return;
      const result = await playTurn(service, turn, played);
      played++;
      if (result === "closed" || played === turns.length) return;
    }
  } catch (cause) {
    if (cause instanceof RelayLoopbackClosed) return;
    throw cause;
  }
}
