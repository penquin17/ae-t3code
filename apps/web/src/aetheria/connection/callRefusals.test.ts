// Per-call device refusals (M10 step 20, D7; review finding 2). Boundary: the report helpers at the reply-decoding layer, wired to a real connection controller through the subscription the hook makes;
// the controller's own rule (only a device-ended code ends access) is shown through the view it produces. The call sites that use the helper are shown by their own tests; this file shows the rule they share,
// not that T3's RPC returns these codes (the remote drill does).
import type { SupervisorConnectionState } from "@t3tools/client-runtime/connection";
import { describe, expect, it } from "vite-plus/test";

import type { SendResult } from "../core/outcome";
import { createConnectionController } from "./controller";
import {
  reportCallRefusal,
  reportRefusalIn,
  reportSendResult,
  subscribeCallRefusals,
} from "./callRefusals";
import { viewOf, type ConnectionFacts } from "./state";

const EXPECTED = `sha256:${"a".repeat(64)}`;

describe("call refusals reach the listeners subscribed now", () => {
  it("delivers a code to each listener, stops after unsubscribe, and drops a report nobody hears", () => {
    const seen: string[] = [];
    reportCallRefusal("BEFORE_DEVICE_REVOKED");
    const stop = subscribeCallRefusals((code) => seen.push(code));
    reportCallRefusal("GROUPS_DEVICE_REVOKED");
    stop();
    reportCallRefusal("AFTER_DEVICE_REVOKED");
    expect(seen).toEqual(["GROUPS_DEVICE_REVOKED"]);
  });
});

const supervisor: SupervisorConnectionState = {
  desired: true,
  network: "online",
  phase: "connected",
  stage: "opening",
  attempt: 1,
  generation: 1,
  lastFailure: null,
  retryAt: null,
};

/** A connected controller whose view the test reads, listening to call refusals the way the hook does. */
async function connectedController() {
  let facts: ConnectionFacts | null = null;
  const controller = createConnectionController({
    expected: { tag: "present", value: EXPECTED },
    probe: async () => ({ tag: "inconclusive", reason: "none" }),
    readComposition: async () => ({
      tag: "read",
      digest: EXPECTED,
      phase: "running",
      modules: [],
    }),
    onFacts: (next) => {
      facts = next;
    },
  });
  const stop = subscribeCallRefusals((code) => controller.reportCallRefusal(code));
  controller.observe({
    supervisor,
    sessions: 1,
    shell: { status: "live", hasSnapshot: true, generation: 7 },
  });
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  return { view: () => viewOf(facts!), stop };
}

describe("a refusal in a reply reaches the connection banner", () => {
  it.each([
    "GROUPS_DEVICE_REVOKED",
    "CHILDREN_DEVICE_REVOKED",
    "JOBS_DEVICE_REVOKED",
    "USAGE_DEVICE_REVOKED",
    "DELIVERABLES_DEVICE_REVOKED",
    "REGIONS_DEVICE_REVOKED",
  ])("%s in a reply ends access while the socket stays open", async (code) => {
    const h = await connectedController();
    expect(h.view()).toMatchObject({ kind: "connected", actions: "allowed" });
    reportRefusalIn({ ok: false, code, detail: "words" });
    expect(h.view()).toMatchObject({
      kind: "access-ended",
      actions: "blocked",
      offer: "sign-in",
      code,
    });
    h.stop();
  });

  it("a download refused for the credential ends access; one refused for another reason does not", async () => {
    const h = await connectedController();
    reportRefusalIn({ tag: "refused", status: 403, code: "DOWNLOAD_NOT_AUTHORIZED", known: true });
    expect(h.view().kind).toBe("connected");
    reportRefusalIn({ tag: "refused", status: 401, code: "DOWNLOAD_BEARER_REQUIRED", known: true });
    expect(h.view().kind).toBe("connected");
    reportRefusalIn({
      tag: "refused",
      status: 401,
      code: "DOWNLOAD_UNAUTHENTICATED",
      known: true,
    });
    expect(h.view()).toMatchObject({ kind: "access-ended", code: "DOWNLOAD_UNAUTHENTICATED" });
    h.stop();
  });

  it.each([
    "GROUPS_NOT_AUTHORIZED",
    "CHILDREN_NOT_AUTHORIZED",
    "JOBS_NOT_AUTHORIZED",
    "NOT_AUTHORIZED",
    "CHILD_NOT_OWNED",
    "CHILDREN_NOT_FOUND",
    "DOWNLOAD_NOT_FOUND",
    "INTERACTION_NOT_FOUND",
  ])("%s (a denied target, not the device) leaves the banner unchanged", async (code) => {
    const h = await connectedController();
    const before = h.view();
    reportRefusalIn({ ok: false, code });
    expect(h.view()).toEqual(before);
    expect(h.view()).toMatchObject({ kind: "connected", actions: "allowed" });
    h.stop();
  });

  it("reads nothing into replies that are not refusals", async () => {
    const h = await connectedController();
    for (const reply of [
      { ok: true, value: { code: "X_DEVICE_REVOKED" } },
      null,
      undefined,
      "GROUPS_DEVICE_REVOKED",
      42,
      { ok: false },
      { ok: false, code: 7 },
      { tag: "bytes" },
    ]) {
      reportRefusalIn(reply);
    }
    expect(h.view().kind).toBe("connected");
    h.stop();
  });
});

describe("reportSendResult passes the result on untouched", () => {
  it("reports an accepted refusal reply and returns the very same result", async () => {
    const h = await connectedController();
    const sent: SendResult<unknown> = {
      tag: "accepted",
      value: { ok: false, code: "JOBS_DEVICE_REVOKED" },
    };
    expect(reportSendResult(sent)).toBe(sent);
    expect(h.view().kind).toBe("access-ended");
    h.stop();
  });

  it("does not report a lost, unavailable or T3-refused result: they carry no Backend code", async () => {
    const h = await connectedController();
    for (const sent of [
      { tag: "lost" },
      { tag: "unavailable", reason: "x" },
      { tag: "refused", code: "COMMAND_FAILED", message: "GROUPS_DEVICE_REVOKED" },
    ] as const) {
      expect(reportSendResult(sent)).toBe(sent);
    }
    expect(h.view().kind).toBe("connected");
    h.stop();
  });
});
