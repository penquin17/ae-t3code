// The client region registry's public surface (D17, XC-19): what a view declares and registers, what M11's client responder queries, and what the shell mounts to report to the Backend.
export { getAppRegionRegistry } from "./appRegistry";
export { INITIAL_REGION_IDS, REGION_DECLARATIONS } from "./declarations";
export { checkDeclaration, declareRegion } from "./descriptor";
export type { RegionDeclaration, RegionDescriptor } from "./descriptor";
export { buildManifest, manifestJson } from "./manifest";
export type { QueryReply, RegionRegistry, Reporter } from "./registry";
export { RegionsSync } from "./RegionsSync";
export { RegionRegistryProvider, useRegion, useRegionRegistry } from "./useRegion";
