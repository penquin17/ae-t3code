// The wiring's decisions (M10 step 20, Phase B; K5, D6–D8): what T3 reported, which probe or status read follows, and which facts the reducer receives.
// Boundary: the controller over a supplied probe and status read and plain values for T3's supervisor, session count and shell state — no socket, no React, no atom. A fake shows the decisions made
// (when to probe, which generation a late reply belongs to, what a refusal or a status does to the view); it does not show that T3's atoms deliver these values in this order (the browser test and the
// remote drill do), nor how a real server answers.
import { decodeAetheriaCompositionStatus } from "@t3tools/aetheria-contracts";
import type { SupervisorConnectionState } from "@t3tools/client-runtime/connection";
import { describe, expect, it } from "vite-plus/test";

import { compositionFromReply, projectionFromShell } from "./adapter";
import { createConnectionController, type ConnectionInputs } from "./controller";
import type { ProbeResult } from "./adapter";
import type { CompositionRead, ConnectionFacts } from "./state";
import { viewOf } from "./state";

const EXPECTED = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;

const supervisor = (patch: Partial<SupervisorConnectionState> = {}): SupervisorConnectionState => ({
  desired: true,
  network: "online",
  phase: "connecting",
  stage: "opening",
  attempt: 1,
  generation: 1,
  lastFailure: null,
  retryAt: null,
  ...patch,
});

const live = { status: "live", hasSnapshot: true, generation: 7 } as const;
const empty = { status: "empty", hasSnapshot: false, generation: 0 } as const;
const cached = { status: "cached", hasSnapshot: true, generation: 7 } as const;

const inputs = (patch: Partial<ConnectionInputs> = {}): ConnectionInputs => ({
  supervisor: supervisor(),
  sessions: 0,
  shell: empty,
  ...patch,
});

const running = (digest = EXPECTED): CompositionRead => ({
  tag: "read",
  digest,
  phase: "running",
  modules: [{ id: "alpha", required: true, state: "running" }],
});

/** Promises the test settles by hand, so a reply can arrive after the world has moved on. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function harness(
  options: {
    expected?: Parameters<typeof createConnectionController>[0]["expected"];
    probe?: () => Promise<ProbeResult>;
    readComposition?: () => Promise<CompositionRead>;
  } = {},
) {
  const probes: string[] = [];
  let reads = 0;
  let facts: ConnectionFacts | null = null;
  const controller = createConnectionController({
    expected: options.expected ?? { tag: "present", value: EXPECTED },
    probe: (digest) => {
      probes.push(digest);
      return (options.probe ?? (async () => ({ tag: "inconclusive", reason: "none" })))();
    },
    readComposition: () => {
      reads += 1;
      return (options.readComposition ?? (async () => running()))();
    },
    onFacts: (next) => {
      facts = next;
    },
  });
  return {
    controller,
    probes,
    reads: () => reads,
    view: () => viewOf(facts!),
    facts: () => facts!,
  };
}

/** Every fake reply settles on the microtask queue, so draining it lets all of them land. */
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

describe("connected only after the session, a current projection and a running status", () => {
  it("is connecting until each is supplied, and names what it still waits for", async () => {
    const h = harness();
    h.controller.observe(inputs());
    expect(h.view()).toMatchObject({ kind: "connecting", actions: "blocked" });

    h.controller.observe(inputs({ supervisor: supervisor({ phase: "connected" }), sessions: 1 }));
    expect(h.view()).toMatchObject({ kind: "connecting", waiting: "baseline", actions: "blocked" });

    h.controller.observe(
      inputs({ supervisor: supervisor({ phase: "connected" }), sessions: 1, shell: live }),
    );
    await settle();
    expect(h.view()).toMatchObject({ kind: "connected", actions: "allowed" });
    expect(h.reads()).toBe(1);
  });

  it("reads the composition status once per connection, not on every T3 update", async () => {
    const h = harness();
    const connected = inputs({
      supervisor: supervisor({ phase: "connected" }),
      sessions: 1,
      shell: live,
    });
    h.controller.observe(connected);
    h.controller.observe({ ...connected, shell: { ...live, generation: 8 } });
    h.controller.observe({ ...connected, shell: { ...live, generation: 9 } });
    await settle();
    expect(h.reads()).toBe(1);
  });

  it("does not claim connected when the status read failed: the Backend's absence is its own state", async () => {
    const h = harness({
      readComposition: async () => ({ tag: "unavailable", reason: "no Backend answered" }),
    });
    h.controller.observe(
      inputs({ supervisor: supervisor({ phase: "connected" }), sessions: 1, shell: live }),
    );
    await settle();
    expect(h.view()).toMatchObject({
      kind: "unknown",
      cause: "composition-unread",
      actions: "blocked",
    });
  });

  it("shows a digest that differs from the build's as a version mismatch with both values and the modules from the status", async () => {
    const h = harness({ readComposition: async () => running(OTHER) });
    h.controller.observe(
      inputs({ supervisor: supervisor({ phase: "connected" }), sessions: 1, shell: live }),
    );
    await settle();
    expect(h.view()).toMatchObject({
      kind: "version-mismatch",
      cause: "digest-differs",
      digests: { expected: EXPECTED, actual: OTHER },
      actions: "blocked",
    });
    expect(h.view().modules.state).toBe("known");
  });
});

describe("a refused connect is read once over HTTP", () => {
  const refusal = {
    tag: "refused",
    refusal: {
      status: 409,
      code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
      message: "digest mismatch",
      expectedDigest: EXPECTED,
      actualDigest: OTHER,
    },
  } as const satisfies ProbeResult;

  it("probes after a backed-off connect with the build's digest, once per attempt, and shows T3's words and the server's", async () => {
    const h = harness({ probe: async () => refusal });
    const backoff = inputs({ supervisor: supervisor({ phase: "backoff", attempt: 1 }) });
    h.controller.observe(backoff);
    h.controller.observe({
      ...backoff,
      supervisor: supervisor({ phase: "backoff", attempt: 1, retryAt: 5 }),
    });
    await settle();
    expect(h.probes).toEqual([EXPECTED]);
    expect(h.view()).toMatchObject({
      kind: "version-mismatch",
      cause: "digest-mismatch",
      code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
      digests: { expected: EXPECTED, actual: OTHER },
    });
    expect(h.view().modules.state).toBe("unavailable");

    h.controller.observe(inputs({ supervisor: supervisor({ phase: "backoff", attempt: 2 }) }));
    await settle();
    expect(h.probes).toHaveLength(2);
  });

  it("does not probe while connecting, connected, offline or blocked by T3, or when the build has no usable digest", async () => {
    const h = harness({ probe: async () => refusal });
    for (const phase of ["available", "connecting", "connected", "offline"] as const) {
      h.controller.observe(inputs({ supervisor: supervisor({ phase, attempt: 3 }), sessions: 1 }));
    }
    await settle();
    expect(h.probes).toEqual([]);

    for (const expected of [{ tag: "absent" }, { tag: "malformed" }] as const) {
      const g = harness({ expected, probe: async () => refusal });
      g.controller.observe(inputs({ supervisor: supervisor({ phase: "backoff", attempt: 1 }) }));
      await settle();
      expect(g.probes).toEqual([]);
    }
  });

  it("leaves the transport's own reading when the probe is inconclusive, and never reports unauthorized from it", async () => {
    const h = harness({ probe: async () => ({ tag: "inconclusive", reason: "answered 401" }) });
    h.controller.observe(inputs({ supervisor: supervisor({ phase: "backoff", attempt: 1 }) }));
    await settle();
    expect(h.view().kind).toBe("reconnecting");
  });

  it("drops a probe's answer that arrives after a new connection began: it belongs to the earlier generation", async () => {
    const late = deferred<ProbeResult>();
    const h = harness({ probe: () => late.promise });
    h.controller.observe(inputs({ supervisor: supervisor({ phase: "backoff", attempt: 1 }) }));
    h.controller.observe(
      inputs({
        supervisor: supervisor({ phase: "connected" }),
        sessions: 1,
        shell: live,
      }),
    );
    await settle();
    expect(h.view().kind).toBe("connected");
    late.resolve(refusal);
    await settle();
    expect(h.view().kind).toBe("connected");
    expect(h.facts().refusal).toBeNull();
  });
});

describe("losing and regaining the connection", () => {
  it("is reconnecting with stale data on a drop, and is connected again only after the new session, the new baseline and a new status read", async () => {
    const h = harness();
    const up = inputs({
      supervisor: supervisor({ phase: "connected" }),
      sessions: 1,
      shell: live,
    });
    h.controller.observe(up);
    await settle();
    expect(h.view().kind).toBe("connected");

    h.controller.observe(
      inputs({
        supervisor: supervisor({ phase: "backoff", attempt: 1 }),
        sessions: 1,
        shell: cached,
      }),
    );
    expect(h.view()).toMatchObject({ kind: "reconnecting", stale: true, actions: "blocked" });

    // The transport reports connected before the new session and baseline arrive: still not connected.
    h.controller.observe(
      inputs({ supervisor: supervisor({ phase: "connected" }), sessions: 1, shell: cached }),
    );
    expect(h.view().kind).not.toBe("connected");

    h.controller.observe(
      inputs({ supervisor: supervisor({ phase: "connected" }), sessions: 2, shell: live }),
    );
    await settle();
    expect(h.view().kind).toBe("connected");
    expect(h.reads()).toBe(2);
  });

  it("drops a status read that arrives after the connection was lost", async () => {
    const late = deferred<CompositionRead>();
    const h = harness({ readComposition: () => late.promise });
    h.controller.observe(
      inputs({ supervisor: supervisor({ phase: "connected" }), sessions: 1, shell: live }),
    );
    h.controller.observe(
      inputs({
        supervisor: supervisor({ phase: "backoff", attempt: 1 }),
        sessions: 1,
        shell: cached,
      }),
    );
    late.resolve(running());
    await settle();
    expect(h.facts().composition).toBeNull();
    expect(h.view().kind).toBe("reconnecting");
  });

  it("is not a first attempt after having been connected", async () => {
    const h = harness();
    h.controller.observe(
      inputs({ supervisor: supervisor({ phase: "connected" }), sessions: 1, shell: live }),
    );
    await settle();
    h.controller.observe(
      inputs({
        supervisor: supervisor({ phase: "connecting", attempt: 1 }),
        sessions: 1,
        shell: cached,
      }),
    );
    expect(h.view().kind).toBe("reconnecting");
  });
});

describe("what a device refusal does", () => {
  it("ends access on a device-ended code even while the socket stays open, and ignores any other code", async () => {
    const h = harness();
    h.controller.observe(
      inputs({ supervisor: supervisor({ phase: "connected" }), sessions: 1, shell: live }),
    );
    await settle();
    h.controller.reportCallRefusal("GROUPS_NOT_AUTHORIZED");
    expect(h.view().kind).toBe("connected");
    h.controller.reportCallRefusal("CHILDREN_DEVICE_REVOKED");
    expect(h.view()).toMatchObject({
      kind: "access-ended",
      offer: "sign-in",
      actions: "blocked",
      code: "CHILDREN_DEVICE_REVOKED",
    });
  });
});

describe("after dispose", () => {
  it("applies nothing: a reply that arrives later changes no facts", async () => {
    const late = deferred<CompositionRead>();
    const h = harness({ readComposition: () => late.promise });
    h.controller.observe(
      inputs({ supervisor: supervisor({ phase: "connected" }), sessions: 1, shell: live }),
    );
    const before = h.facts();
    h.controller.dispose();
    late.resolve(running());
    await settle();
    expect(h.facts()).toBe(before);
  });
});

describe("T3's shell state becomes a projection", () => {
  it.each([
    [{ status: "empty", hasSnapshot: false, generation: 0 }, { phase: "awaiting-baseline" }],
    [{ status: "synchronizing", hasSnapshot: true, generation: 3 }, { phase: "awaiting-baseline" }],
    [{ status: "live", hasSnapshot: false, generation: 3 }, { phase: "awaiting-baseline" }],
    [
      { status: "live", hasSnapshot: true, generation: 3 },
      { phase: "live", version: 3, stale: false, needsBaseline: false },
    ],
    [
      { status: "cached", hasSnapshot: true, generation: 3 },
      { phase: "live", version: 3, stale: true, needsBaseline: true },
    ],
  ] as const)("%j is %j", (shell, expected) => {
    expect(projectionFromShell(shell)).toMatchObject(expected);
  });
});

describe("the status read's reply becomes the composition fact", () => {
  const body = {
    composition: "aetheria-backend",
    host: "backend",
    phase: "running",
    digest: { version: 1, algorithm: "sha256", value: EXPECTED },
    artifact: { package: "backend-archive", version: "0.1.0", stamp: OTHER },
    activationOrder: ["alpha"],
    modules: [{ id: "alpha", required: true, state: "running" }],
    disposal: null,
  };

  it("reads an accepted, well-shaped status", () => {
    expect(compositionFromReply({ tag: "accepted", value: body })).toEqual(
      compositionFromStatusShape(),
    );
    expect(
      decodeAetheriaCompositionStatus(body as Parameters<typeof decodeAetheriaCompositionStatus>[0])
        .digest.value,
    ).toBe(EXPECTED);
  });

  it.each([
    [{ tag: "accepted", value: { ...body, extra: 1 } }, /shape/],
    [{ tag: "accepted", value: "nope" }, /shape/],
    [{ tag: "refused", code: "COMMAND_FAILED", message: "T3 says no" }, /T3 says no/],
    [{ tag: "lost" }, /never arrived/],
    [{ tag: "unavailable", reason: "no Backend" }, /no Backend/],
  ] as const)("%j is unavailable with its own words", (reply, words) => {
    const read = compositionFromReply(reply);
    expect(read.tag).toBe("unavailable");
    if (read.tag === "unavailable") expect(read.reason).toMatch(words);
  });

  function compositionFromStatusShape(): CompositionRead {
    return running();
  }
});

describe("a different environment is a different connection", () => {
  it("starts again from nothing read, even when its session count equals the last one's", async () => {
    const h = harness();
    const up = {
      supervisor: supervisor({ phase: "connected" }),
      sessions: 1,
      shell: live,
    } as const;
    h.controller.observe({ ...up, environmentId: "env-a" });
    await settle();
    expect(h.view().kind).toBe("connected");
    h.controller.observe({ ...up, environmentId: "env-b", shell: empty });
    // Not connected, and waiting for the new environment's own baseline (the client has been connected before, so it is not a first attempt).
    expect(h.view()).toMatchObject({
      kind: "reconnecting",
      waiting: "baseline",
      actions: "blocked",
    });
    await settle();
    expect(h.reads()).toBe(2);
  });
});
