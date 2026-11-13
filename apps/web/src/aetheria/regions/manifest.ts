// The manifest of declared regions (D17, XC-19), generated from the declarations — never inferred from the page. It is sorted by id and rendered byte for byte the same every time, so a generator run is
// deterministic and a full-page test (step 24) can compare the set of mounted regions with it exactly (a missing and an extra region both fail). A duplicate id, an undeclared parent and a parent cycle
// are refused here, so the manifest never describes a tree that cannot exist.
import { REGIONS_SCHEMA_VERSION } from "@t3tools/aetheria-contracts";

import type { RegionDescriptor } from "./descriptor";

export interface RegionManifest {
  readonly schemaVersion: number;
  readonly regions: readonly RegionDescriptor[];
}

export function buildManifest(descriptors: readonly RegionDescriptor[]): RegionManifest {
  const byId = new Map<string, RegionDescriptor>();
  for (const descriptor of descriptors) {
    if (byId.has(descriptor.id)) throw new Error(`duplicate region id "${descriptor.id}"`);
    byId.set(descriptor.id, descriptor);
  }
  for (const descriptor of byId.values()) {
    if (descriptor.parent !== null && !byId.has(descriptor.parent))
      throw new Error(`parent "${descriptor.parent}" of "${descriptor.id}" is not declared`);
    const walked = new Set<string>([descriptor.id]);
    for (let up = descriptor.parent; up !== null; up = byId.get(up)!.parent) {
      if (walked.has(up)) throw new Error(`region "${descriptor.id}" is in a parent cycle`);
      walked.add(up);
    }
  }
  return {
    schemaVersion: REGIONS_SCHEMA_VERSION,
    regions: [...byId.values()].toSorted((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

/** The manifest as the generator writes it: two-space JSON and one final newline. */
export const manifestJson = (descriptors: readonly RegionDescriptor[]): string =>
  `${JSON.stringify(buildManifest(descriptors), null, 2)}\n`;
