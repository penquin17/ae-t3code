// The Backend's `aetheria.usage.read` value as the usage panel reads it (M10 Plan step 18, D14, XC-11). The contract keeps what could and could not be read apart: a usage section that is read or unavailable,
// a children section that is listed or unavailable, and per child a route that is known, none or unknown with an availability that is read or unavailable. The panel shows routes that have a state and
// readings; everything the Backend could not supply is carried as a note in its own words, so an unread section is never shown as an empty one and an unavailable reading is never a usage of 0.
// Plain TypeScript: no DOM, no T3 import. A value that is not the contract's shape is returned as it is, so the panel's strict parse refuses it visibly instead of this adapter guessing.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface Notes {
  readings?: string;
  routes?: string;
  children?: string[];
}

export function usageFromContract(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.usage) || !isRecord(value.children)) return value;
  const { usage, children } = value;
  const notes: Notes = {};
  const readings: unknown[] = [];
  if (usage.status === "read" && Array.isArray(usage.readings)) readings.push(...usage.readings);
  else if (usage.status === "unavailable" && typeof usage.detail === "string")
    notes.readings = usage.detail;
  else return value;

  const routes: unknown[] = [];
  if (children.status === "listed" && Array.isArray(children.rows)) {
    const lines: string[] = [];
    for (const row of children.rows as unknown[]) {
      if (!isRecord(row) || typeof row.childThreadId !== "string" || !isRecord(row.route))
        return value;
      const child = row.childThreadId;
      const { route, availability } = row;
      if (route.status === "none") {
        lines.push(`Child ${child}: no route is recorded for it.`);
      } else if (route.status === "unknown") {
        lines.push(
          `Child ${child}: its route is not known (${typeof route.detail === "string" ? route.detail : "no reason given"}).`,
        );
      } else if (route.status === "known") {
        if (isRecord(availability) && availability.status === "read" && availability.state) {
          routes.push({
            route: { provider: route.provider, model: route.model },
            childLabel: child,
            state: availability.state,
          });
        } else {
          const reason =
            isRecord(availability) && typeof availability.detail === "string"
              ? availability.detail
              : "no answer";
          lines.push(
            `Child ${child}: its route ${String(route.provider)}/${String(route.model)} is recorded, but its availability could not be read (${reason}).`,
          );
        }
      } else return value;
    }
    if (lines.length > 0) notes.children = lines;
  } else if (children.status === "unavailable" && typeof children.detail === "string") {
    notes.routes = children.detail;
  } else return value;

  const hasNotes =
    notes.readings !== undefined || notes.routes !== undefined || notes.children !== undefined;
  return { routes, readings, ...(hasNotes ? { notes } : {}) };
}
