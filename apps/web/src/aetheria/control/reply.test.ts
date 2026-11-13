import { describe, expect, it } from "vite-plus/test";

import { classifyTransport, sendResultOf } from "./reply";
import type { InteractionRecord, TransportResult } from "./types";

const RECORD: InteractionRecord = {
  interactionId: "i-1",
  state: "answered",
  revision: "a".repeat(64),
  rootSessionId: "root",
  sessionId: "root",
  createdAt: "2026-01-01T00:00:00Z",
  held: false,
  kind: "question",
  content: { questions: [{ id: "q", question: "Which?" }] },
};
const reply = (value: unknown): TransportResult => ({ tag: "reply", reply: value });
const fail = (code: string, extra: object = {}) => reply({ ok: false, code, ...extra });

describe("an action reply becomes one honest class", () => {
  it("an accepted reply carries the record and asks for a re-read to confirm it", () => {
    const result = classifyTransport(reply({ ok: true, value: RECORD }));
    expect(result).toMatchObject({ class: "accepted", value: RECORD, reread: true });
    expect(sendResultOf(result)).toEqual({ tag: "accepted", value: RECORD });
  });

  it.each([
    "nothing was done",
    "outcome unknown: the commit may or may not have landed",
    "",
    "the service is not accepting work",
  ])("EVERY INTERACTION_UNAVAILABLE is unknown plus a re-read, whatever it says: %j", (detail) => {
    const result = classifyTransport(fail("INTERACTION_UNAVAILABLE", { detail }));
    expect(result).toMatchObject({ class: "unknown", reread: true });
    expect(sendResultOf(result)).toEqual({ tag: "lost" });
  });

  it("a stale revision is a conflict that carries the Backend's words and a re-read", () => {
    const result = classifyTransport(
      fail("INTERACTION_STALE_REVISION", { detail: "the content changed since the human saw it" }),
    );
    expect(result).toMatchObject({ class: "stale-revision", reread: true });
    expect(sendResultOf(result)).toEqual({
      tag: "refused",
      code: "INTERACTION_STALE_REVISION",
      message: "the content changed since the human saw it",
    });
  });

  it("already-settled keeps the settling record as supplied", () => {
    const settled = { ...RECORD, state: "cancelled" as const };
    const result = classifyTransport(fail("INTERACTION_ALREADY_SETTLED", { record: settled }));
    expect(result).toMatchObject({ class: "already-settled", record: settled, reread: true });
  });

  it("delivery-failed keeps the record and is never an unchanged refusal", () => {
    const result = classifyTransport(
      fail("INTERACTION_DELIVERY_FAILED", { record: RECORD, detail: "the session is gone" }),
    );
    expect(result).toMatchObject({
      class: "delivery-failed",
      record: RECORD,
      detail: "the session is gone",
    });
    expect(sendResultOf(result)).toMatchObject({
      tag: "refused",
      code: "INTERACTION_DELIVERY_FAILED",
    });
  });

  it.each([
    "INTERACTION_ORIGIN_NOT_HUMAN",
    "INTERACTION_ANSWER_INVALID",
    "INTERACTION_GRANT_INVALID",
  ])("%s is a refusal with the Backend's words verbatim and no re-read", (code) => {
    const result = classifyTransport(fail(code, { detail: "the connection is read-only (x)" }));
    expect(result).toMatchObject({ class: "refused", reread: false });
    expect(sendResultOf(result)).toEqual({
      tag: "refused",
      code,
      message: "the connection is read-only (x)",
    });
  });

  it("a refusal without words carries an empty message, never an invented one", () => {
    expect(sendResultOf(classifyTransport(fail("INTERACTION_NOT_FOUND")))).toEqual({
      tag: "refused",
      code: "INTERACTION_NOT_FOUND",
      message: "",
    });
  });

  it.each([
    ["a code this client does not know", fail("SOMETHING_NEW")],
    ["a value that is not a reply", reply("ok")],
    ["null", reply(null)],
    ["ok without a value", reply({ ok: true })],
    ["a coded failure without a code", reply({ ok: false })],
    ["a lost reply", { tag: "lost" } as TransportResult],
  ])("%s is unknown and prompts a re-read, never a pass", (_name, input) => {
    const result = classifyTransport(input);
    expect(result).toMatchObject({ class: "unknown", reread: true });
    expect(sendResultOf(result)).toEqual({ tag: "lost" });
  });

  it("a T3-level failure (scope, socket) is a refusal in T3's own words", () => {
    const result = classifyTransport({ tag: "failed", message: "scope orchestration:operate" });
    expect(sendResultOf(result)).toEqual({
      tag: "refused",
      code: "COMMAND_FAILED",
      message: "scope orchestration:operate",
    });
    expect(result.reread).toBe(false);
  });
});
