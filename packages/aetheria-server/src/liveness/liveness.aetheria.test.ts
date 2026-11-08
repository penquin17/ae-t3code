// AETHERIA M04 Plan step 14 (B3) — the Backend liveness service, judged through its public surface with stored-event-shaped input.
// Shows: how each T3 provider-session record maps to running/settled/stopped/crash/restart/unknown, that `agent_end` is not a settle
// (only the adapter's own `ready` is), that a missed observation is `unknown` and never free-looking, and that an observer cannot alter
// the service. The REAL two-Pi-process proof is tests/awareness/b3/native.test.mjs; this file does not claim it.
import { describe, expect, it } from "vite-plus/test";

import {
  consumeLivenessStream,
  createLivenessService,
  type LivenessInputEvent,
  type LivenessObservation,
} from "./index.ts";

let sequence = 0;
const session = (id: string, status: string) => ({
  id,
  status,
  driver: "pi",
  cwd: "/w",
  model: null,
  lastError: null,
});
const updated = (
  threadId: string,
  id: string,
  status: string,
  seq = ++sequence,
): LivenessInputEvent => ({
  sequence: seq,
  type: "provider-session.updated",
  threadId,
  payload: session(id, status),
});
const attached = (
  threadId: string,
  id: string,
  status: string,
  seq = ++sequence,
): LivenessInputEvent => ({
  sequence: seq,
  type: "provider-session.attached",
  threadId,
  payload: session(id, status),
});
const detached = (
  threadId: string,
  id: string,
  reason = "manual_shutdown",
  seq = ++sequence,
): LivenessInputEvent => ({
  sequence: seq,
  type: "provider-session.detached",
  threadId,
  payload: { providerSessionId: id, reason },
});
const other = (threadId: string, seq = ++sequence): LivenessInputEvent => ({
  sequence: seq,
  type: "message.updated",
  threadId,
  payload: { text: "NOT-READ" },
});
const fresh = () => {
  sequence = 0;
  let clock = 1000;
  const service = createLivenessService({ now: () => (clock += 1) });
  return service;
};

describe("what each stored provider-session record means", () => {
  it("reports a holder nobody has observed as unknown, with the reason", () => {
    const service = fresh();
    const seen = service.status("thread-never");
    expect(seen.kind).toBe("unknown");
    expect(seen.reason).toBe("never-observed");
    expect(seen.lastKnown).toBeNull();
  });

  it("maps running and waiting to running, ready to settled, stopped to stopped, error to crash", () => {
    const service = fresh();
    service.ingest(attached("t", "s1", "starting"));
    expect(service.status("t").kind).toBe("running"); // a launching holder is not free
    expect(service.status("t").basis).toBe("starting");
    service.ingest(updated("t", "s1", "running"));
    expect(service.status("t").kind).toBe("running");
    service.ingest(updated("t", "s1", "waiting"));
    expect(service.status("t").kind).toBe("running"); // blocked mid-run on a person is still a run
    service.ingest(updated("t", "s1", "ready"));
    expect(service.status("t").kind).toBe("settled");
    service.ingest(updated("t", "s1", "stopped"));
    expect(service.status("t").kind).toBe("stopped");

    service.ingest(attached("c", "s2", "ready"));
    service.ingest(updated("c", "s2", "error"));
    expect(service.status("c").kind).toBe("crash");
  });

  it("keeps a still-running holder and a settled holder apart, per thread", () => {
    const service = fresh();
    service.ingest(attached("a", "sa", "ready"));
    service.ingest(attached("b", "sb", "ready"));
    service.ingest(updated("a", "sa", "running"));
    service.ingest(updated("b", "sb", "running"));
    service.ingest(updated("b", "sb", "ready"));
    expect(service.status("a").kind).toBe("running");
    expect(service.status("b").kind).toBe("settled");
  });

  it("treats only the adapter's ready as a settle: events other than a provider-session record never settle a run", () => {
    const service = fresh();
    service.ingest(attached("a", "sa", "running"));
    // agent_end reaches T3 as turn/message records, not as a ready status; none of them may change the holder.
    for (const type of [
      "turn.terminal",
      "provider-turn.updated",
      "message.updated",
      "run.updated",
      "provider-thread.updated",
    ]) {
      service.ingest({ sequence: ++sequence, type, threadId: "a", payload: { status: "ready" } });
    }
    expect(service.status("a").kind).toBe("running");
  });

  it("answers by provider session too, and tells the two apart after a restart", () => {
    const service = fresh();
    service.ingest(attached("a", "s1", "running"));
    expect(service.statusOfProviderSession("s1")?.threadId).toBe("a");
    expect(service.statusOfProviderSession("nope")).toBeNull();
  });
});

describe("crash, stop and restart", () => {
  it("does not let a graceful detach hide a crash that came first", () => {
    const service = fresh();
    service.ingest(attached("a", "s1", "running"));
    service.ingest(updated("a", "s1", "error"));
    service.ingest(updated("a", "s1", "error")); // the release record repeats the status
    service.ingest(detached("a", "s1", "runtime_error"));
    expect(service.status("a").kind).toBe("crash");
  });

  it("reads a detach of a live holder as stopped", () => {
    const service = fresh();
    service.ingest(attached("a", "s1", "running"));
    service.ingest(detached("a", "s1"));
    expect(service.status("a").kind).toBe("stopped");
    expect(service.status("a").basis).toBe("detached");
  });

  it("reports a new session after a stop or crash as restart, with a higher incarnation, until it runs", () => {
    const service = fresh();
    service.ingest(attached("a", "s1", "running"));
    service.ingest(updated("a", "s1", "error"));
    expect(service.status("a").incarnation).toBe(1);
    service.ingest(attached("a", "s2", "starting"));
    const restarted = service.status("a");
    expect(restarted.kind).toBe("restart");
    expect(restarted.incarnation).toBe(2);
    expect(restarted.providerSessionId).toBe("s2");
    service.ingest(updated("a", "s2", "running"));
    expect(service.status("a").kind).toBe("running");
    expect(service.status("a").incarnation).toBe(2);
    expect(service.statusOfProviderSession("s1")).toBeNull(); // the old incarnation is no longer a holder
  });

  it("does not let a late record of an old session undo the restart", () => {
    const service = fresh();
    service.ingest(attached("a", "s1", "running"));
    service.ingest(updated("a", "s1", "stopped"));
    service.ingest(attached("a", "s2", "ready"));
    service.ingest(updated("a", "s1", "error"));
    expect(service.status("a").providerSessionId).toBe("s2");
    expect(service.status("a").kind).toBe("restart");
  });
});

describe("a missed or unreadable observation is unknown, never free-looking", () => {
  it("turns every holder unknown on a sequence gap and keeps what it last knew", () => {
    const service = fresh();
    service.ingest(attached("a", "sa", "running"));
    service.ingest(attached("b", "sb", "ready"));
    service.ingest(updated("b", "sb", "stopped"));
    sequence += 3; // three stored events never reached the service
    service.ingest(other("a"));
    expect(service.status("a")).toMatchObject({
      kind: "unknown",
      reason: "gap",
      lastKnown: "running",
    });
    expect(service.status("b")).toMatchObject({
      kind: "unknown",
      reason: "gap",
      lastKnown: "stopped",
    });
  });

  it("recovers a holder only by observing it again", () => {
    const service = fresh();
    service.ingest(attached("a", "sa", "running"));
    service.noteGap("feed-lost");
    expect(service.status("a").kind).toBe("unknown");
    service.ingest(updated("a", "sa", "ready"));
    expect(service.status("a").kind).toBe("settled");
  });

  it("ignores a replayed or out-of-order record instead of letting it rewrite the present", () => {
    const service = fresh();
    service.ingest(attached("a", "sa", "ready"));
    service.ingest(updated("a", "sa", "running"));
    service.ingest(updated("a", "sa", "ready", 1)); // an old sequence
    expect(service.status("a").kind).toBe("running");
  });

  it("marks a holder unknown when its record cannot be read", () => {
    const service = fresh();
    service.ingest(attached("a", "sa", "running"));
    service.ingest({
      sequence: ++sequence,
      type: "provider-session.updated",
      threadId: "a",
      payload: { id: "sa", status: "levitating" },
    });
    expect(service.status("a")).toMatchObject({
      kind: "unknown",
      reason: "unreadable",
      lastKnown: "running",
    });
    service.ingest({
      sequence: ++sequence,
      type: "provider-session.updated",
      threadId: "a",
      payload: null,
    });
    expect(service.status("a").kind).toBe("unknown");
  });

  it("starts with no baseline: the first event may have any sequence", () => {
    const service = fresh();
    service.ingest(attached("a", "sa", "running", 500));
    expect(service.status("a").kind).toBe("running");
  });
});

describe("the feed", () => {
  const events = async function* (list: LivenessInputEvent[], fail = false) {
    for (const event of list) yield event;
    if (fail) throw new Error("socket closed");
  };

  it("ingests every event of a stream", async () => {
    const service = fresh();
    await consumeLivenessStream(
      service,
      events([attached("a", "sa", "running"), updated("a", "sa", "ready")]),
    );
    // the stream ended: whatever it said before is now unobserved going forward
    expect(service.status("a")).toMatchObject({
      kind: "unknown",
      reason: "feed-ended",
      lastKnown: "settled",
    });
  });

  it("turns holders unknown when the stream fails, and does not throw", async () => {
    const service = fresh();
    const outcome = await consumeLivenessStream(
      service,
      events([attached("a", "sa", "running")], true),
    );
    expect(outcome).toEqual({ ended: "failed" });
    expect(service.status("a")).toMatchObject({
      kind: "unknown",
      reason: "feed-failed",
      lastKnown: "running",
    });
  });
});

describe("an observer", () => {
  it("sees frozen observations on change only, and its failure never reaches the service", async () => {
    const service = fresh();
    const seen: LivenessObservation[] = [];
    const handle = service.observe((o) => {
      seen.push(o);
      throw new Error("observer bug");
    });
    service.observe(async () => {
      throw new Error("async observer bug");
    });
    service.ingest(attached("a", "sa", "running"));
    service.ingest(updated("a", "sa", "running", ++sequence)); // no change: no notification
    service.ingest(updated("a", "sa", "ready"));
    await Promise.resolve();
    expect(seen.map((o) => o.kind)).toEqual(["running", "settled"]);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(() => {
      (seen[0] as { kind: string }).kind = "settled";
    }).toThrow();
    expect(service.status("a").kind).toBe("settled");
    handle.close();
    service.ingest(updated("a", "sa", "running"));
    expect(seen).toHaveLength(2);
  });

  it("holds only what it needs: no payload text, model, cwd or error text leaves the service", () => {
    const service = fresh();
    service.ingest({
      sequence: 1,
      type: "provider-session.updated",
      threadId: "a",
      payload: {
        id: "sa",
        status: "error",
        cwd: "/secret/place",
        model: "m",
        lastError: "TOKEN-xyz leaked",
      },
    });
    expect(JSON.stringify(service.snapshot())).not.toMatch(/secret|TOKEN|leaked/);
    expect(Object.keys(service.status("a")).sort()).toEqual([
      "basis",
      "incarnation",
      "kind",
      "lastKnown",
      "observedAt",
      "providerSessionId",
      "reason",
      "sequence",
      "threadId",
    ]);
  });

  it("is exposed as the service surface and nothing that writes", () => {
    const service = fresh();
    expect(Object.keys(service).sort()).toEqual([
      "ingest",
      "noteGap",
      "observe",
      "snapshot",
      "status",
      "statusOfProviderSession",
    ]);
    expect(Object.isFrozen(service)).toBe(true);
  });
});
