// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M04 Plan step 15 (B5) — the pre-upgrade gate for a connection that declares the Backend digest it expects (IP-9).
//
// What this shows: the gate's decision and the safe body it returns, for every outcome, and that ws.ts calls it before the upgrade's
// authentication and session work. It does not run the websocket upgrade itself: the ws.ts wiring is checked by reading its source, so a real
// upgrade refusal (client side) is not exercised here.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import { backendDigestRefusal, xc6DigestRefusal } from "./connectionGate.ts";

const v = `sha256:${"a".repeat(64)}`;
const w = `sha256:${"b".repeat(64)}`;
const actual = { version: 1, algorithm: "sha256", value: v } as const;
const composition = Option.some({ digest: actual });
const url = (query: string) => new URL(`http://localhost/ws?${query}`);
const declare = (value: string) => `aetheriaExpectedBackendDigest=${encodeURIComponent(value)}`;

describe("backendDigestRefusal", () => {
  it("leaves a connection that declares nothing untouched, with or without the Backend (bare T3)", () => {
    expect(
      backendDigestRefusal(url("orchestrationProtocolVersion=1"), composition),
    ).toBeUndefined();
    expect(
      backendDigestRefusal(url("orchestrationProtocolVersion=1"), Option.none()),
    ).toBeUndefined();
  });

  it("lets a matching declaration through", () => {
    expect(backendDigestRefusal(url(declare(v)), composition)).toBeUndefined();
  });

  it("refuses a different declared digest before anything else, reporting only digest and version facts", () => {
    const refusal = backendDigestRefusal(url(declare(w)), composition);
    expect(refusal?.status).toBe(409);
    expect(refusal?.body).toMatchObject({
      code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
      actualDigest: actual,
      expectedDigest: { version: 1, algorithm: "sha256", value: w },
    });
    expect(Object.keys(refusal?.body ?? {}).sort()).toEqual([
      "actualDigest",
      "code",
      "expectedDigest",
      "message",
    ]);
  });

  it("refuses a declaration when this server runs no Aetheria Backend", () => {
    const refusal = backendDigestRefusal(url(declare(v)), Option.none());
    expect(refusal?.status).toBe(409);
    expect(refusal?.body).toMatchObject({
      code: "AETHERIA_BACKEND_DIGEST_ABSENT",
      expectedDigest: { value: v },
    });
    expect(refusal?.body).not.toHaveProperty("actualDigest");
  });

  it("refuses a malformed, empty or repeated declaration without echoing it", () => {
    for (const query of [
      declare("/home/user/.secret"),
      "aetheriaExpectedBackendDigest=",
      `${declare(v)}&${declare(v)}`,
    ]) {
      const refusal = backendDigestRefusal(url(query), composition);
      expect(refusal?.status).toBe(409);
      expect(refusal?.body.code).toBe("AETHERIA_BACKEND_DIGEST_MALFORMED");
      expect(JSON.stringify(refusal)).not.toContain("secret");
    }
  });
});

describe("xc6DigestRefusal", () => {
  it("changes nothing when no Backend is provided and nothing is declared (the probe layer)", () => {
    expect(xc6DigestRefusal(undefined, Option.none())).toBeUndefined();
  });
  it("requires a present matching declaration once the Backend is provided", () => {
    expect(xc6DigestRefusal(v, composition)).toBeUndefined();
    expect(xc6DigestRefusal(w, composition)?.body.code).toBe("AETHERIA_BACKEND_DIGEST_MISMATCH");
    expect(xc6DigestRefusal(undefined, composition)?.body.code).toBe(
      "AETHERIA_BACKEND_DIGEST_MALFORMED",
    );
    expect(xc6DigestRefusal([v, v], composition)?.body.code).toBe(
      "AETHERIA_BACKEND_DIGEST_MALFORMED",
    );
  });
  it("refuses a declaration to a server with no Backend", () => {
    expect(xc6DigestRefusal(v, Option.none())?.body.code).toBe("AETHERIA_BACKEND_DIGEST_ABSENT");
  });
});

describe("the XC-6 route wiring", () => {
  const source = NodeFS.readFileSync(
    NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "xc6Route.ts"),
    "utf8",
  );
  it("gates the request after bearer resolution and before the body is read or any operation runs", () => {
    const resolve = source.indexOf("registry.resolve(token)");
    const gate = source.indexOf("xc6DigestRefusal(");
    const body = source.indexOf("request.text");
    const handle = source.indexOf("backend.handle(");
    expect(resolve).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(resolve);
    expect(body).toBeGreaterThan(gate);
    expect(handle).toBeGreaterThan(gate);
  });
});

describe("the ws.ts wiring", () => {
  const source = NodeFS.readFileSync(
    NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../ws.ts"),
    "utf8",
  );
  it("marks the seam and applies the gate in the pre-upgrade check, before authentication and session work", () => {
    // Built from two parts so this test file is not itself read as an integration-point marker.
    const marker = source.lastIndexOf(["AETHERIA-IP", "IP-9"].join(":"));
    const gate = source.indexOf("backendDigestRefusal(");
    const auth = source.indexOf("const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;", gate);
    expect(marker).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(gate);
    expect(
      source.indexOf("hasCompatibleOrchestrationProtocol(url.value)", marker - 1000),
    ).toBeGreaterThan(-1);
  });
});
