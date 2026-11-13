import {
  CLIENT_CAPABILITIES_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
  SETTINGS_SECRET_REFERENCES_CAPABILITY,
  type ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";

import { ConnectionBlockedError } from "./model.ts";

export function orchestrationProtocolCompatibilityError(
  descriptor: ExecutionEnvironmentDescriptor,
): ConnectionBlockedError | null {
  // Servers shipped before negotiation use the original wire protocol.
  const serverProtocolVersion = descriptor.orchestrationProtocolVersion ?? 1;
  if (serverProtocolVersion === ORCHESTRATION_PROTOCOL_VERSION) {
    return null;
  }
  return serverProtocolVersion > ORCHESTRATION_PROTOCOL_VERSION
    ? new ConnectionBlockedError({
        reason: "unsupported",
        detail: `This client is not supported by this server. Update your app or use a compatible release to connect to ${descriptor.label}.`,
      })
    : new ConnectionBlockedError({
        reason: "unsupported",
        detail: `This client requires a newer server. Update T3 Code on ${descriptor.label} to connect.`,
        ...(canSelfUpdate(descriptor) ? { serverUpdateRequired: true } : {}),
      });
}

function canSelfUpdate(descriptor: ExecutionEnvironmentDescriptor): boolean {
  const { serverSelfUpdate, desktopAppUpdate } = descriptor.capabilities;
  return (
    serverSelfUpdate !== undefined &&
    (serverSelfUpdate !== "desktop-managed" || desktopAppUpdate === true)
  );
}

// AETHERIA-IP:IP-57 the Backend composition digest this build expects, embedded at build (VITE_AETHERIA_BACKEND_DIGEST), declared on every connect so the server's pre-upgrade gate can refuse skew
export const EXPECTED_BACKEND_DIGEST_QUERY_PARAM = "aetheriaExpectedBackendDigest";
// This package's own program has no Vite client types; the declaration is the same one Vite's types make (`ImportMeta.env: ImportMetaEnv`), so a program that has them merges it.
declare global {
  interface ImportMetaEnv {
    readonly VITE_AETHERIA_BACKEND_DIGEST?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
function embeddedBackendDigest(): string | undefined {
  // The literal `import.meta.env.VITE_…` is what Vite replaces at build; a cast of `import.meta` would be left unreplaced and read nothing.
  const raw: unknown = import.meta.env.VITE_AETHERIA_BACKEND_DIGEST;
  const value = typeof raw === "string" ? raw.trim() : "";
  return value === "" ? undefined : value;
}

export function appendOrchestrationProtocol(socketUrl: string): string {
  const url = new URL(socketUrl);
  url.searchParams.set(ORCHESTRATION_PROTOCOL_QUERY_PARAM, String(ORCHESTRATION_PROTOCOL_VERSION));
  url.searchParams.set(CLIENT_CAPABILITIES_QUERY_PARAM, SETTINGS_SECRET_REFERENCES_CAPABILITY);
  // AETHERIA-IP:IP-57
  const digest = embeddedBackendDigest();
  if (digest !== undefined) url.searchParams.set(EXPECTED_BACKEND_DIGEST_QUERY_PARAM, digest);
  return url.toString();
}
