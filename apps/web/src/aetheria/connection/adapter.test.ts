// The adapter (K5): the only place T3's wire and the Backend's wire become the model's facts. Boundary: functions over values and a supplied `fetch`; no real socket.
// A fake `fetch` shows what the probe asks and how it reads an answer; it does not show how a real server or browser answers (that is the remote drill, step 21).
import { decodeAetheriaCompositionStatus } from "@t3tools/aetheria-contracts";
import type { SupervisorConnectionState } from "@t3tools/client-runtime/connection";
import { describe, expect, it } from "vite-plus/test";

import { applyEvent, initialFacts, viewOf, type ConnectionFacts } from "./state";
import {
  compositionFromStatus,
  expectedDigestFrom,
  parseUpgradeRefusal,
  probeUpgrade,
  transportFromSupervisor,
} from "./adapter";

const EXPECTED = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;

const supervisor = (patch: Partial<SupervisorConnectionState>): SupervisorConnectionState => ({
  desired: true,
  network: "online",
  phase: "connected",
  stage: null,
  attempt: 1,
  generation: 3,
  lastFailure: null,
  retryAt: null,
  ...patch,
});

describe("expected digest from the build", () => {
  it.each([
    [undefined, { tag: "absent" }],
    ["", { tag: "absent" }],
    ["   ", { tag: "absent" }],
    ["sha256:short", { tag: "malformed" }],
    [EXPECTED.toUpperCase(), { tag: "malformed" }],
    [EXPECTED, { tag: "present", value: EXPECTED }],
    [` ${EXPECTED}\n`, { tag: "present", value: EXPECTED }],
  ] as const)("%j is read as %j", (raw, expected) => {
    expect(expectedDigestFrom(raw)).toEqual(expected);
  });
});

describe("T3's supervisor state becomes transport facts", () => {
  it("keeps phase, stage, attempt and retry time, and names a blocked failure's reason and detail", () => {
    expect(
      transportFromSupervisor(supervisor({ phase: "backoff", attempt: 4, retryAt: 99 })),
    ).toEqual({
      network: "online",
      phase: "backoff",
      stage: null,
      attempt: 4,
      retryAt: 99,
      blocked: null,
    });
    const blocked = transportFromSupervisor(
      supervisor({
        phase: "blocked",
        lastFailure: {
          _tag: "ConnectionBlockedError",
          reason: "permission",
          detail: "T3 permission words",
        } as never,
      }),
    );
    expect(blocked.blocked).toEqual({ reason: "permission", detail: "T3 permission words" });
  });

  it("a failure that is only transient is not reported as blocked", () => {
    const transient = transportFromSupervisor(
      supervisor({
        phase: "backoff",
        lastFailure: {
          _tag: "ConnectionTransientError",
          reason: "transport",
          detail: "socket closed",
        } as never,
      }),
    );
    expect(transient.blocked).toBeNull();
  });
});

describe("an upgrade refusal body is read strictly", () => {
  it("keeps the code, message and digests of a well-formed body and ignores unknown keys", () => {
    expect(
      parseUpgradeRefusal(409, {
        code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
        message: "words",
        actualDigest: { version: 1, algorithm: "sha256", value: OTHER },
        expectedDigest: { version: 1, algorithm: "sha256", value: EXPECTED },
        extra: "ignored",
      }),
    ).toEqual({
      status: 409,
      code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
      message: "words",
      actualDigest: OTHER,
      expectedDigest: EXPECTED,
    });
  });

  it("keeps only the status when the body is not the expected shape", () => {
    for (const body of [null, "text", 7, [], { code: 5, message: {} }, { actualDigest: "nope" }]) {
      expect(parseUpgradeRefusal(409, body)).toEqual({ status: 409 });
    }
  });

  it("drops a digest that is not digest-v1 rather than showing it", () => {
    expect(
      parseUpgradeRefusal(409, {
        code: "X",
        expectedDigest: { version: 1, algorithm: "sha256", value: "nope" },
      }),
    ).toEqual({
      status: 409,
      code: "X",
    });
  });
});

describe("the composition status", () => {
  it("is read from the decoded status as digest, phase and modules — nothing else", () => {
    const status = decodeAetheriaCompositionStatus({
      composition: "aetheria-backend",
      host: "backend",
      phase: "running",
      digest: { version: 1, algorithm: "sha256", value: EXPECTED },
      artifact: { package: "backend-archive", version: "0.1.0", stamp: OTHER },
      activationOrder: ["alpha"],
      modules: [{ id: "alpha", required: true, state: "running" }],
      disposal: null,
    });
    expect(compositionFromStatus(status)).toEqual({
      tag: "read",
      digest: EXPECTED,
      phase: "running",
      modules: [{ id: "alpha", required: true, state: "running" }],
    });
  });
});

describe("K5: a changed wire mapping behind the adapter leaves the view unchanged", () => {
  it("two different mappings of the same facts give the same view", () => {
    const viaSupervisor = transportFromSupervisor(supervisor({ phase: "connected" }));
    // A hypothetical later wire that reports a boolean instead of a phase; only this mapping changes.
    const viaBoolean = ((wire: { up: boolean }) => ({
      network: "online" as const,
      phase: wire.up ? ("connected" as const) : ("backoff" as const),
      stage: null,
      attempt: 1,
      retryAt: null,
      blocked: null,
    }))({ up: true });
    const run = (transport: typeof viaSupervisor): ConnectionFacts =>
      [
        { type: "transport", generation: 1, transport },
        { type: "ready", generation: 1 },
        {
          type: "composition",
          generation: 1,
          result: { tag: "read", digest: EXPECTED, phase: "running", modules: [] },
        },
      ].reduce(
        (facts, event) => applyEvent(facts, event as never),
        initialFacts({ tag: "present", value: EXPECTED }),
      );
    expect(viewOf(run(viaSupervisor))).toEqual(viewOf(run(viaBoolean)));
  });
});

describe("probing the upgrade (a browser cannot read a refused upgrade's status or body)", () => {
  const reply = (status: number, body: unknown) => async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  const probeWith = (fetchImpl: typeof fetch) =>
    probeUpgrade({
      fetch: fetchImpl,
      httpBaseUrl: "https://host.test/base/",
      expectedDigest: EXPECTED,
    });

  it("asks the same /ws path with the expected digest and the protocol version, and sends no credential", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    await probeWith((async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response("{}", { status: 401 });
    }) as typeof fetch);
    const url = new URL(seen[0]!.url);
    expect(url.origin + url.pathname).toBe("https://host.test/ws");
    expect(url.searchParams.get("aetheriaExpectedBackendDigest")).toBe(EXPECTED);
    expect(url.searchParams.get("orchestrationProtocol")).not.toBeNull();
    expect(url.searchParams.has("wsTicket")).toBe(false);
    expect(seen[0]!.init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error" });
    expect(JSON.stringify(seen[0]!.init?.headers ?? {})).not.toMatch(/authorization|cookie/i);
  });

  it("reads a 409 digest refusal and a 426 protocol refusal", async () => {
    const body = {
      code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
      message: "words",
      actualDigest: { version: 1, algorithm: "sha256", value: OTHER },
      expectedDigest: { version: 1, algorithm: "sha256", value: EXPECTED },
    };
    expect(await probeWith(reply(409, body) as never)).toEqual({
      tag: "refused",
      refusal: {
        status: 409,
        code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
        message: "words",
        actualDigest: OTHER,
        expectedDigest: EXPECTED,
      },
    });
    expect(
      await probeWith(
        reply(426, { code: "orchestration_protocol_incompatible", message: "update" }) as never,
      ),
    ).toEqual({
      tag: "refused",
      refusal: { status: 426, code: "orchestration_protocol_incompatible", message: "update" },
    });
  });

  it("does not take an unauthenticated 401 as the device being unauthorized", async () => {
    expect(await probeWith(reply(401, {}) as never)).toMatchObject({ tag: "inconclusive" });
    expect(await probeWith(reply(403, {}) as never)).toMatchObject({ tag: "inconclusive" });
    expect(await probeWith(reply(200, "") as never)).toMatchObject({ tag: "inconclusive" });
  });

  it("is inconclusive, not a guess, when the request fails", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await probeWith(failing)).toEqual({
      tag: "inconclusive",
      reason: "the probe request failed",
    });
  });

  it("refuses to probe with no usable expected digest", async () => {
    const result = await probeUpgrade({
      fetch: (async () => new Response("", { status: 409 })) as typeof fetch,
      httpBaseUrl: "https://host.test",
      expectedDigest: "nope",
    });
    expect(result).toEqual({
      tag: "inconclusive",
      reason: "this build carries no usable expected digest",
    });
  });
});
