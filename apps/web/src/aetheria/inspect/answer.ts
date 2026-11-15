// M11 step 21 (C6; D2–D5, D9, D12): answers one Backend request from the page's own region registry only (mounted: live values where the descriptor says `value`).
// A declared but unmounted region is `inactive` with its shape and no value; unknown is `region-not-found`; another descriptor version is `schema-unsupported`.
// Values are keyed `props.<f>`, `state.<f>`, `tokens.<--n>`; the Backend applies the descriptor again. No request, no action, no DOM read.
import type { InspectClientRequest, InspectReplyPayload } from "@t3tools/aetheria-contracts";

import type { RegionDescriptor } from "../regions/descriptor";
import type { QueryReply, Reading, RegionRegistry } from "../regions/registry";

/** A descriptor's declared shape: what the region is and which of its fields a query may report a value for. No value. */
const shapeOf = (descriptor: RegionDescriptor) => ({
  id: descriptor.id,
  kind: descriptor.kind,
  description: descriptor.description,
  schemaVersion: descriptor.schemaVersion,
  props: descriptor.props.map((f) => ({ name: f.name, type: f.type, report: f.report })),
  state: descriptor.state.map((f) => ({ name: f.name, type: f.type, report: f.report })),
  tokens: [...descriptor.tokens],
});

const valuesOf = (reply: Extract<QueryReply, { readonly ok: true }>): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  const take = (group: "props" | "state", readings: readonly Reading[]) => {
    for (const reading of readings)
      if (reading.status === "value") values[`${group}.${reading.name}`] = reading.value;
  };
  take("props", reply.props);
  take("state", reply.state);
  for (const token of reply.tokens)
    if (token.status === "value") values[`tokens.${token.name}`] = token.value;
  return values;
};

export interface AnswerSources {
  readonly registry: RegionRegistry;
  /** The regions the build declares (generated declarations): a declared region the page has not mounted is inactive. */
  readonly declared: readonly RegionDescriptor[];
}

export function answerRequest(
  request: InspectClientRequest,
  sources: AnswerSources,
): InspectReplyPayload {
  const { requestId, regionId, schemaVersion } = request;
  const mounted = sources.registry.snapshot().regions.find((r) => r.descriptor.id === regionId);
  if (mounted === undefined) {
    const declared = sources.declared.find((d) => d.id === regionId);
    if (declared === undefined) return { requestId, outcome: "region-not-found" };
    if (declared.schemaVersion !== schemaVersion)
      return { requestId, outcome: "schema-unsupported" };
    return {
      requestId,
      outcome: "ok",
      state: "inactive",
      shape: shapeOf(declared),
      values: {},
    };
  }
  const reply = sources.registry.query(regionId, { schemaVersion });
  if (!reply.ok) return { requestId, outcome: reply.outcome };
  return {
    requestId,
    outcome: "ok",
    state: "active",
    shape: shapeOf(mounted.descriptor),
    values: valuesOf(reply),
  };
}
