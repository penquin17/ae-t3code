import { ORCHESTRATION_PROTOCOL_VERSION } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  appendOrchestrationProtocol,
  EXPECTED_BACKEND_DIGEST_QUERY_PARAM,
} from "./compatibility.ts";

// Aetheria's IP-57: the build's expected Backend digest, declared on every connect so the server's pre-upgrade gate can refuse skew.
describe("the expected Backend digest declared on connect (IP-57)", () => {
  const DIGEST = `sha256:${"ab".repeat(32)}`;
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("declares the digest the build embedded, beside the protocol and without disturbing credentials", () => {
    vi.stubEnv("VITE_AETHERIA_BACKEND_DIGEST", DIGEST);
    const url = new URL(appendOrchestrationProtocol("wss://host.test/ws?wsTicket=secret"));
    expect(EXPECTED_BACKEND_DIGEST_QUERY_PARAM).toBe("aetheriaExpectedBackendDigest");
    expect(url.searchParams.get(EXPECTED_BACKEND_DIGEST_QUERY_PARAM)).toBe(DIGEST);
    expect(url.searchParams.get("orchestrationProtocol")).toBe(
      String(ORCHESTRATION_PROTOCOL_VERSION),
    );
    expect(url.searchParams.get("clientCapabilities")).toBe("settingsSecretReferences");
    expect(url.searchParams.get("wsTicket")).toBe("secret");
  });

  it("trims the value and replaces a digest already on the url rather than adding a second", () => {
    vi.stubEnv("VITE_AETHERIA_BACKEND_DIGEST", `  ${DIGEST}\n`);
    const url = new URL(
      appendOrchestrationProtocol(`wss://host.test/ws?${EXPECTED_BACKEND_DIGEST_QUERY_PARAM}=old`),
    );
    expect(url.searchParams.getAll(EXPECTED_BACKEND_DIGEST_QUERY_PARAM)).toEqual([DIGEST]);
  });

  it.each(["", "   "])("declares nothing when the build embedded %j", (value) => {
    vi.stubEnv("VITE_AETHERIA_BACKEND_DIGEST", value);
    const url = new URL(appendOrchestrationProtocol("wss://host.test/ws"));
    expect(url.searchParams.has(EXPECTED_BACKEND_DIGEST_QUERY_PARAM)).toBe(false);
  });
});
