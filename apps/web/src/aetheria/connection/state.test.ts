// The truthful connection model (C4/C1, D6–D8): the states a person sees and the actions they may take, derived from supplied facts only.
// Boundary: pure functions over facts — no socket, no T3 wire. Each case names the fact that must (or must not) change the state.
import { describe, expect, it } from "vite-plus/test";

import { CANONICAL_CODES } from "../refusals/canonical";
import { applyBaseline, applyIncrement, awaitingBaseline, markDisconnected } from "../core/resync";
import {
  applyEvent,
  initialFacts,
  isDeviceEndedCode,
  viewOf,
  type CompositionRead,
  type ConnectionEvent,
  type ConnectionFacts,
  type TransportFacts,
} from "./state";

const EXPECTED = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;

const open: TransportFacts = {
  network: "online",
  phase: "connected",
  stage: null,
  attempt: 1,
  retryAt: null,
  blocked: null,
};
const connecting: TransportFacts = { ...open, phase: "connecting", stage: "opening" };
const backoff: TransportFacts = { ...open, phase: "backoff", retryAt: 5000, attempt: 2 };
const offline: TransportFacts = { ...open, phase: "offline", network: "offline" };
const idle: TransportFacts = { ...open, phase: "available", network: "unknown", attempt: 0 };

const running = (digest = EXPECTED): Extract<CompositionRead, { tag: "read" }> => ({
  tag: "read",
  digest,
  phase: "running",
  modules: [
    { id: "alpha", required: true, state: "running" },
    { id: "beta", required: false, state: "failed" },
  ],
});

const live = applyBaseline(awaitingBaseline<number>(), 1, 1);

const fold = (
  events: readonly ConnectionEvent[],
  facts = initialFacts({ tag: "present", value: EXPECTED }),
) => events.reduce(applyEvent, facts);

/** Everything a healthy generation reports. */
const healthy = (generation: number, digest = EXPECTED): ConnectionEvent[] => [
  { type: "transport", generation, transport: { ...open } },
  { type: "ready", generation },
  { type: "projection", generation, projection: live },
  { type: "composition", generation, result: running(digest) },
];

const kindOf = (facts: ConnectionFacts) => viewOf(facts).kind;

describe("connected means ready, current and verified — not a socket that is open", () => {
  it("is disconnected before anything starts", () => {
    const view = viewOf(initialFacts({ tag: "present", value: EXPECTED }));
    expect(view).toMatchObject({ kind: "disconnected", actions: "blocked", stale: false });
  });

  it("is connecting while the transport prepares or opens", () => {
    const facts = fold([{ type: "transport", generation: 1, transport: connecting }]);
    expect(viewOf(facts)).toMatchObject({ kind: "connecting", actions: "blocked" });
    expect(viewOf(facts).waiting).toBeUndefined();
  });

  it.each([
    ["backend ready", [{ type: "transport", generation: 1, transport: open }], "ready"],
    [
      "the projection baseline",
      [
        { type: "transport", generation: 1, transport: open },
        { type: "ready", generation: 1 },
      ],
      "baseline",
    ],
    [
      "the composition status",
      [
        { type: "transport", generation: 1, transport: open },
        { type: "ready", generation: 1 },
        { type: "projection", generation: 1, projection: live },
      ],
      "composition",
    ],
  ] as const)("an open socket still waits for %s", (_label, events, waiting) => {
    const view = viewOf(fold(events));
    expect(view).toMatchObject({ kind: "connecting", waiting, actions: "blocked" });
  });

  it("connects only when ready, projected and verified, and then allows actions", () => {
    const view = viewOf(fold(healthy(1)));
    expect(view).toMatchObject({
      kind: "connected",
      actions: "allowed",
      offer: "none",
      stale: false,
    });
    expect(view.modules).toEqual({ state: "known", value: running().modules });
  });

  it("a backend still starting is waiting, one that failed is unknown — neither is connected", () => {
    const base = healthy(1).slice(0, 3);
    const starting = fold([
      ...base,
      { type: "composition", generation: 1, result: { ...running(), phase: "starting" } },
    ]);
    expect(viewOf(starting)).toMatchObject({
      kind: "connecting",
      waiting: "backend",
      actions: "blocked",
    });
    const failed = fold([
      ...base,
      { type: "composition", generation: 1, result: { ...running(), phase: "failed" } },
    ]);
    expect(viewOf(failed)).toMatchObject({
      kind: "unknown",
      cause: "backend-not-running",
      actions: "blocked",
    });
  });
});

describe("network loss and reconnection", () => {
  it("keeps the last value but marks it stale, and blocks actions, through loss and backoff", () => {
    const connected = fold(healthy(1));
    const lost = applyEvent(connected, { type: "transport", generation: 1, transport: offline });
    expect(viewOf(lost)).toMatchObject({
      kind: "disconnected",
      cause: "offline",
      stale: true,
      actions: "blocked",
    });
    const retry = applyEvent(lost, { type: "transport", generation: 1, transport: backoff });
    expect(viewOf(retry)).toMatchObject({
      kind: "reconnecting",
      stale: true,
      retryAt: 5000,
      attempt: 2,
      actions: "blocked",
    });
  });

  it("after reconnecting, a new generation is not connected until its own ready and baseline arrive", () => {
    let facts = fold(healthy(1));
    facts = applyEvent(facts, { type: "transport", generation: 2, transport: open });
    expect(viewOf(facts)).toMatchObject({
      kind: "reconnecting",
      waiting: "ready",
      stale: true,
      actions: "blocked",
    });
    facts = fold(
      [
        { type: "ready", generation: 2 },
        { type: "projection", generation: 2, projection: markDisconnected(live) },
        { type: "composition", generation: 2, result: running() },
      ],
      facts,
    );
    expect(viewOf(facts)).toMatchObject({ kind: "reconnecting", waiting: "baseline" });
    facts = applyEvent(facts, {
      type: "projection",
      generation: 2,
      projection: applyBaseline(live, 2, 2),
    });
    expect(viewOf(facts)).toMatchObject({ kind: "connected", stale: false, actions: "allowed" });
  });

  it("an increment gap sends the connection back to waiting for a baseline", () => {
    const gapped = applyIncrement(live, 5, (n) => n + 1);
    expect(gapped).toMatchObject({ phase: "live", needsBaseline: true });
    const facts = fold([
      ...healthy(1).slice(0, 2),
      { type: "projection", generation: 1, projection: gapped },
      { type: "composition", generation: 1, result: running() },
    ]);
    expect(viewOf(facts)).toMatchObject({
      kind: "connecting",
      waiting: "baseline",
      actions: "blocked",
    });
  });

  it("does not present an old module list as current once the connection is lost or its access ended", () => {
    const connected = fold(healthy(1));
    expect(viewOf(connected).modules.state).toBe("known");
    for (const lost of [
      applyEvent(connected, { type: "transport", generation: 1, transport: backoff }),
      applyEvent(connected, { type: "transport", generation: 1, transport: offline }),
      applyEvent(connected, { type: "call-refused", generation: 1, code: "JOBS_DEVICE_REVOKED" }),
    ]) {
      expect(viewOf(lost).modules.state, viewOf(lost).kind).toBe("unavailable");
    }
  });

  it("a connection that never connected is not called stale", () => {
    const facts = fold([{ type: "transport", generation: 1, transport: backoff }]);
    expect(viewOf(facts)).toMatchObject({ kind: "reconnecting", stale: false });
  });

  it("an idle transport (not wanted) is disconnected with no cause of its own", () => {
    expect(viewOf(fold([{ type: "transport", generation: 1, transport: idle }]))).toMatchObject({
      kind: "disconnected",
    });
  });
});

describe("a refused upgrade is read from the status and the server's own words", () => {
  const refuse = (status: number, body?: Parameters<typeof refusal>[1]) =>
    fold([
      { type: "transport", generation: 1, transport: backoff },
      { type: "upgrade-refused", generation: 1, refusal: refusal(status, body) },
    ]);
  const refusal = (
    status: number,
    body: { code?: string; message?: string; actualDigest?: string; expectedDigest?: string } = {},
  ) => ({ status, ...body });

  it("409 digest mismatch shows both digests and the server's message unchanged, and names no module", () => {
    const message =
      "This server's Aetheria Backend was built from a different composition than this client expects.";
    const view = viewOf(
      refuse(409, {
        code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
        message,
        actualDigest: OTHER,
        expectedDigest: EXPECTED,
      }),
    );
    expect(view).toMatchObject({
      kind: "version-mismatch",
      cause: "digest-mismatch",
      code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
      actions: "blocked",
      offer: "reload",
      digests: { expected: EXPECTED, actual: OTHER },
      detail: { source: "server", text: message },
    });
    // The refusal body has no module list; the model never guesses one (A5).
    expect(view.modules.state).toBe("unavailable");
    expect(JSON.stringify(view)).not.toMatch(/different module|which module/i);
  });

  it.each([
    ["AETHERIA_BACKEND_DIGEST_ABSENT", "digest-absent"],
    ["AETHERIA_BACKEND_DIGEST_MALFORMED", "digest-malformed"],
  ] as const)("409 %s is %s with the server's words", (code, cause) => {
    const view = viewOf(refuse(409, { code, message: "server words", expectedDigest: EXPECTED }));
    expect(view).toMatchObject({
      kind: "version-mismatch",
      cause,
      code,
      detail: { source: "server", text: "server words" },
      digests: { expected: EXPECTED },
    });
    expect(view.digests?.actual).toBeUndefined();
  });

  it("426 is a version mismatch with T3's words", () => {
    const text = "Update this client to one that supports orchestration protocol 2.";
    const view = viewOf(
      refuse(426, { code: "orchestration_protocol_incompatible", message: text }),
    );
    expect(view).toMatchObject({
      kind: "version-mismatch",
      cause: "protocol",
      offer: "reload",
      detail: { source: "server", text },
    });
  });

  it.each([401, 403])("%i is unauthorized — never 'revoked' — and offers sign-in", (status) => {
    const view = viewOf(refuse(status));
    expect(view).toMatchObject({ kind: "unauthorized", offer: "sign-in", actions: "blocked" });
    expect(view.kind).not.toBe("access-ended");
  });

  it("a 409 whose code is not one of the three, and any other status, is unknown and shows the words it was given", () => {
    const odd = viewOf(refuse(409, { code: "SOMETHING_NEW", message: "new words" }));
    expect(odd).toMatchObject({
      kind: "unknown",
      cause: "unrecognised-refusal",
      code: "SOMETHING_NEW",
      detail: { text: "new words" },
    });
    expect(viewOf(refuse(502))).toMatchObject({ kind: "unknown", cause: "unrecognised-refusal" });
  });

  it("T3's blocked reasons map without an upgrade body", () => {
    const blocked = (reason: "authentication" | "permission" | "unsupported" | "configuration") =>
      kindOf(
        fold([
          {
            type: "transport",
            generation: 1,
            transport: { ...open, phase: "blocked", blocked: { reason, detail: "T3 words" } },
          },
        ]),
      );
    expect(blocked("authentication")).toBe("unauthorized");
    expect(blocked("permission")).toBe("unauthorized");
    expect(blocked("unsupported")).toBe("version-mismatch");
    expect(blocked("configuration")).toBe("unknown");
    const view = viewOf(
      fold([
        {
          type: "transport",
          generation: 1,
          transport: {
            ...open,
            phase: "blocked",
            blocked: { reason: "authentication", detail: "T3 words" },
          },
        },
      ]),
    );
    expect(view.detail).toEqual({ source: "t3", text: "T3 words" });
  });
});

describe("per-call refusals update the state even while the socket stays open", () => {
  it("a device-revoked code ends access (revoked or expired — the Backend does not say which)", () => {
    const facts = applyEvent(fold(healthy(1)), {
      type: "call-refused",
      generation: 1,
      code: "JOBS_DEVICE_REVOKED",
    });
    expect(viewOf(facts)).toMatchObject({
      kind: "access-ended",
      code: "JOBS_DEVICE_REVOKED",
      actions: "blocked",
      offer: "sign-in",
    });
  });

  it.each([
    "JOBS_NOT_AUTHORIZED",
    "CHILDREN_NOT_FOUND",
    "GROUPS_UNAVAILABLE",
    "USAGE_UNAVAILABLE",
    "SOMETHING_NEW",
  ])("%s alone does not claim the device was revoked", (code) => {
    const facts = applyEvent(fold(healthy(1)), { type: "call-refused", generation: 1, code });
    expect(viewOf(facts)).toMatchObject({ kind: "connected", actions: "allowed" });
  });

  it("classifies every canonical *_DEVICE_REVOKED code, and no other", () => {
    const ended = CANONICAL_CODES.filter((c) => /DEVICE_REVOKED$/.test(c.code)).map((c) => c.code);
    expect(ended.length).toBeGreaterThanOrEqual(4);
    for (const code of ended) expect(isDeviceEndedCode(code), code).toBe(true);
    for (const { code } of CANONICAL_CODES.filter((c) => !ended.includes(c.code))) {
      expect(isDeviceEndedCode(code), code).toBe(false);
    }
  });
});

describe("the composition status verifies the digest and supplies the module list", () => {
  it("a status that cannot be read leaves the version unverified: unknown, actions blocked, reload offered", () => {
    const facts = fold([
      ...healthy(1).slice(0, 3),
      {
        type: "composition",
        generation: 1,
        result: { tag: "unavailable", reason: "the call failed" },
      },
    ]);
    expect(viewOf(facts)).toMatchObject({
      kind: "unknown",
      cause: "composition-unread",
      actions: "blocked",
      offer: "reload",
    });
  });

  it("a status digest that differs from the expected one is a mismatch, with its module list read from the status", () => {
    const view = viewOf(fold(healthy(1, OTHER)));
    expect(view).toMatchObject({
      kind: "version-mismatch",
      cause: "digest-differs",
      actions: "blocked",
      offer: "reload",
      digests: { expected: EXPECTED, actual: OTHER },
    });
    expect(view.modules).toEqual({ state: "known", value: running().modules });
  });
});

describe("a build that carries no usable expected digest cannot claim the gate works", () => {
  it.each([
    [{ tag: "absent" }, "client-digest-absent"],
    [{ tag: "malformed" }, "client-digest-malformed"],
  ] as const)(
    "%j is a version mismatch even when every other fact is healthy",
    (expected, cause) => {
      const view = viewOf(fold(healthy(1), initialFacts(expected)));
      expect(view).toMatchObject({
        kind: "version-mismatch",
        cause,
        actions: "blocked",
        offer: "reload",
        detail: { source: "client" },
      });
    },
  );
});

describe("generations", () => {
  it("drops every reply from an older generation", () => {
    let facts = fold(healthy(1));
    facts = applyEvent(facts, { type: "transport", generation: 2, transport: connecting });
    for (const late of [
      { type: "call-refused", generation: 1, code: "JOBS_DEVICE_REVOKED" },
      { type: "upgrade-refused", generation: 1, refusal: { status: 403 } },
      { type: "ready", generation: 1 },
      { type: "projection", generation: 1, projection: live },
      { type: "composition", generation: 1, result: running() },
      { type: "transport", generation: 1, transport: open },
    ] as const) {
      expect(applyEvent(facts, late)).toBe(facts);
    }
    expect(kindOf(facts)).toBe("reconnecting");
  });

  it("a new generation forgets the old generation's refusal and readiness but not that it once connected", () => {
    let facts = applyEvent(fold(healthy(1)), {
      type: "call-refused",
      generation: 1,
      code: "JOBS_DEVICE_REVOKED",
    });
    expect(kindOf(facts)).toBe("access-ended");
    facts = applyEvent(facts, { type: "transport", generation: 2, transport: connecting });
    expect(viewOf(facts)).toMatchObject({ kind: "reconnecting", stale: true });
  });
});

describe("words", () => {
  const sample = (): ConnectionFacts[] => [
    initialFacts({ tag: "present", value: EXPECTED }),
    fold([{ type: "transport", generation: 1, transport: connecting }]),
    fold(healthy(1)),
    fold([{ type: "transport", generation: 1, transport: backoff }]),
    fold([{ type: "transport", generation: 1, transport: offline }]),
    fold([
      { type: "transport", generation: 1, transport: open },
      { type: "upgrade-refused", generation: 1, refusal: { status: 401 } },
    ]),
    applyEvent(fold(healthy(1)), {
      type: "call-refused",
      generation: 1,
      code: "JOBS_DEVICE_REVOKED",
    }),
    fold(healthy(1, OTHER)),
    fold([
      { type: "transport", generation: 1, transport: open },
      { type: "upgrade-refused", generation: 1, refusal: { status: 500 } },
    ]),
  ];

  it("gives every state a headline in both languages and never an empty one", () => {
    for (const facts of sample()) {
      for (const locale of ["en", "zh"] as const) {
        const view = viewOf(facts, locale);
        expect(view.headline.trim(), `${view.kind}/${view.cause} ${locale}`).not.toBe("");
      }
      expect(viewOf(facts, "zh").headline).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it("allows actions in exactly one state", () => {
    expect(
      sample()
        .filter((f) => viewOf(f).actions === "allowed")
        .map((f) => viewOf(f).kind),
    ).toEqual(["connected"]);
  });
});
