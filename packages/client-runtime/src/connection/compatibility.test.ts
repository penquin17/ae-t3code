import {
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_VERSION,
  type ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  appendOrchestrationProtocol,
  EXPECTED_BACKEND_DIGEST_QUERY_PARAM,
  orchestrationProtocolCompatibilityError,
} from "./compatibility.ts";

const descriptor = (orchestrationProtocolVersion?: number): ExecutionEnvironmentDescriptor => ({
  environmentId: EnvironmentId.make("environment-remote"),
  label: "Build Mac",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "9.0.0",
  ...(orchestrationProtocolVersion === undefined ? {} : { orchestrationProtocolVersion }),
  capabilities: { repositoryIdentity: true },
});

describe("orchestration protocol compatibility", () => {
  it("accepts the current protocol and announces it without disturbing socket credentials", () => {
    expect(
      orchestrationProtocolCompatibilityError(descriptor(ORCHESTRATION_PROTOCOL_VERSION)),
    ).toBeNull();

    const socketUrl = new URL(
      appendOrchestrationProtocol("wss://host.test/ws?wsTicket=secret&connectionMethod=relay"),
    );
    expect(socketUrl.searchParams.get("orchestrationProtocol")).toBe(
      String(ORCHESTRATION_PROTOCOL_VERSION),
    );
    expect(socketUrl.searchParams.get("clientCapabilities")).toBe("settingsSecretReferences");
    expect(socketUrl.searchParams.get("wsTicket")).toBe("secret");
    expect(socketUrl.searchParams.get("connectionMethod")).toBe("relay");
  });

  it("treats missing metadata as protocol 1", () => {
    const error = orchestrationProtocolCompatibilityError(descriptor());
    if (Number(ORCHESTRATION_PROTOCOL_VERSION) === 1) {
      expect(error).toBeNull();
    } else {
      expect(error).toMatchObject({ reason: "unsupported" });
    }
  });

  it("blocks a different protocol before connecting", () => {
    const error = orchestrationProtocolCompatibilityError(
      descriptor(ORCHESTRATION_PROTOCOL_VERSION + 1),
    );
    expect(error).toMatchObject({ reason: "unsupported" });
    expect(error?.message).toContain("This client is not supported");
    expect(error).not.toHaveProperty("serverUpdateRequired");
  });

  it("offers a remote update only for an older host that can update itself", () => {
    const older = descriptor(ORCHESTRATION_PROTOCOL_VERSION - 1);
    const withCapabilities = (capabilities: ExecutionEnvironmentDescriptor["capabilities"]) =>
      orchestrationProtocolCompatibilityError({ ...older, capabilities });

    expect(
      withCapabilities({ repositoryIdentity: true, serverSelfUpdate: "boot-service" }),
    ).toMatchObject({ serverUpdateRequired: true });
    expect(withCapabilities({ repositoryIdentity: true })).not.toHaveProperty(
      "serverUpdateRequired",
    );
    expect(
      withCapabilities({ repositoryIdentity: true, serverSelfUpdate: "desktop-managed" }),
    ).not.toHaveProperty("serverUpdateRequired");
    expect(
      withCapabilities({
        repositoryIdentity: true,
        serverSelfUpdate: "desktop-managed",
        desktopAppUpdate: true,
      }),
    ).toMatchObject({ serverUpdateRequired: true });
  });
});

// AETHERIA-IP:IP-57 the build's expected Backend digest, declared on every connect so the server's pre-upgrade gate can refuse skew
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

  it("declares nothing when the build embedded no digest: an empty or blank value is absent, never sent", () => {
    for (const value of ["", "   "]) {
      vi.stubEnv("VITE_AETHERIA_BACKEND_DIGEST", value);
      const url = new URL(appendOrchestrationProtocol("wss://host.test/ws"));
      expect(url.searchParams.has(EXPECTED_BACKEND_DIGEST_QUERY_PARAM)).toBe(false);
    }
  });
});
