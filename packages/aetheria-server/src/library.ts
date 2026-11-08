// AETHERIA — the one module that touches the pinned library artifact (design M02 D7/C3, Plan step 12).
//
// `@aetheria/awareness/backend` is the Backend-only entry of the packed archive declared in package.json. Everything the adapter takes from
// it — the shared composition validator, the digest, the lifecycle driver and the XC-7 report — is named here, so the artifact edge has
// exactly one import site and a test can check that. No other module imports an `@aetheria/*` package.
import {
  compareFaults,
  createHost,
  dispose,
  evaluate,
  hostStatus,
  register,
  start,
  type Activation,
  type DigestReport,
  type DisposalReport,
  type LifecycleHost,
  type ModuleStatus,
  type StartResult,
} from "@aetheria/awareness/backend";

export { compareFaults, createHost, dispose, evaluate, hostStatus, register, start };
export type { Activation, DigestReport, DisposalReport, LifecycleHost, ModuleStatus, StartResult };

/** A reportable problem, as the shared validator and lifecycle driver return it. */
export type Fault = Extract<StartResult, { readonly outcome: "refused" }>["faults"][number];

/** The runtime functions the adapter calls; a test checks each exists on the installed archive's Backend entry. */
export const LIBRARY_EXPORTS = [
  "compareFaults",
  "createHost",
  "dispose",
  "evaluate",
  "hostStatus",
  "register",
  "start",
] as const;
