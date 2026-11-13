// Client region registry (D17, XC-19): `register` takes a declared descriptor and a pure in-memory reporter and returns a disposer; `snapshot` lists what is mounted and visible, with no value.
// `query` answers M11's responder from the descriptor alone: a value only where it says `value`, the shape otherwise, explicit omitted reasons, the three named failures; token values are read only then.
// The reporter makes no request and calls no action.
import type { FieldType, RegionDescriptor } from "./descriptor";

/** A reporter returns the region's CURRENT declared props and state; any key it holds that the descriptor did not declare is never read. */
export type Reporter = () => { readonly props?: object; readonly state?: object };

export type OmitReason = "not-reported" | "not-plain-data" | "too-large" | "unavailable";
export type Reading =
  | { readonly name: string; readonly status: "value"; readonly value: unknown }
  | { readonly name: string; readonly status: "shape"; readonly type: FieldType }
  | { readonly name: string; readonly status: "omitted"; readonly reason: OmitReason };
export type TokenReading =
  | { readonly name: string; readonly status: "value"; readonly value: string }
  | { readonly name: string; readonly status: "omitted"; readonly reason: "unavailable" };

export type QueryFailure = "region-not-found" | "schema-unsupported" | "unavailable";
export type QueryReply =
  | {
      readonly ok: true;
      readonly clientId: string;
      readonly regionId: string;
      readonly schemaVersion: number;
      readonly capturedAt: string;
      readonly props: readonly Reading[];
      readonly state: readonly Reading[];
      readonly tokens: readonly TokenReading[];
    }
  | {
      readonly ok: false;
      readonly outcome: QueryFailure;
      readonly clientId: string;
      readonly regionId: string;
      readonly capturedAt: string;
      /** Present on `schema-unsupported`: the one version this region's descriptor carries. */
      readonly supportedSchemaVersion?: number;
    };

export interface RegionSnapshot {
  readonly clientId: string;
  /** Sorted by id, so one set always reads the same way. */
  readonly regions: ReadonlyArray<{
    readonly descriptor: RegionDescriptor;
    readonly visible: boolean;
  }>;
}

export interface RegionRegistry {
  readonly clientId: string;
  /** Registers (or replaces) a region; the disposer removes it, and only if it is still the registration it made. */
  register(
    descriptor: RegionDescriptor,
    reporter: Reporter,
    options?: { readonly visible?: boolean },
  ): () => void;
  setVisible(regionId: string, visible: boolean): void;
  snapshot(): RegionSnapshot;
  query(regionId: string, options?: { readonly schemaVersion?: number }): QueryReply;
  subscribe(listener: () => void): () => void;
  /** Removes every region and refuses to hold another; for module disposal. */
  dispose(): void;
}

export interface RegistryDeps {
  /** Random per page load; the Backend binds it to the authenticated connection, the client asserts no principal. */
  readonly clientId: string;
  readonly now: () => number;
  /** A design token's live value, read from the page's computed style. */
  readonly readToken: (name: string) => string | undefined;
}

/** A value reported by `value` is at most this much plain data (string length plus a small weight per node). */
const MAX_VALUE_WEIGHT = 8192;
const MAX_DEPTH = 6;

type Plain =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: OmitReason };

/** A copy of plain JSON data within the weight budget, or why it cannot be one. A cycle, a function, a class instance, a non-finite number or an undefined member is not plain. */
function toPlain(input: unknown): Plain {
  let weight = 0;
  const seen = new Set<object>();
  const walk = (value: unknown, depth: number): Plain => {
    if (weight > MAX_VALUE_WEIGHT) return { ok: false, reason: "too-large" };
    if (value === null || typeof value === "boolean") {
      weight += 4;
      return { ok: true, value };
    }
    if (typeof value === "number") {
      weight += 8;
      return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: "not-plain-data" };
    }
    if (typeof value === "string") {
      weight += value.length + 2;
      return weight > MAX_VALUE_WEIGHT ? { ok: false, reason: "too-large" } : { ok: true, value };
    }
    if (typeof value !== "object") return { ok: false, reason: "not-plain-data" };
    if (seen.has(value)) return { ok: false, reason: "not-plain-data" };
    if (depth >= MAX_DEPTH) return { ok: false, reason: "too-large" };
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        const copy: unknown[] = [];
        for (const member of value) {
          const inner = walk(member, depth + 1);
          if (!inner.ok) return inner;
          copy.push(inner.value);
        }
        return { ok: true, value: copy };
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null)
        return { ok: false, reason: "not-plain-data" };
      const copy: Record<string, unknown> = {};
      for (const key of Object.keys(value)) {
        weight += key.length + 2;
        const inner = walk((value as Record<string, unknown>)[key], depth + 1);
        if (!inner.ok) return inner;
        copy[key] = inner.value;
      }
      return { ok: true, value: copy };
    } finally {
      seen.delete(value);
    }
  };
  return walk(input, 0);
}

const shapeOf = (value: unknown): FieldType | undefined => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return undefined;
  }
};

/** One declared field's reading: only the descriptor's own names are read, from own properties of what the reporter returned. */
function readField(
  field: RegionDescriptor["props"][number],
  reported: object | undefined,
): Reading {
  const name = field.name;
  if (reported === undefined || !Object.hasOwn(reported, name))
    return { name, status: "omitted", reason: "not-reported" };
  const raw = (reported as Record<string, unknown>)[name];
  if (raw === undefined) return { name, status: "omitted", reason: "not-reported" };
  if (field.report === "value") {
    const plain = toPlain(raw);
    return plain.ok
      ? { name, status: "value", value: plain.value }
      : { name, status: "omitted", reason: plain.reason };
  }
  const type = shapeOf(raw);
  return type === undefined
    ? { name, status: "omitted", reason: "not-plain-data" }
    : { name, status: "shape", type };
}

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

export function createRegionRegistry(deps: RegistryDeps): RegionRegistry {
  interface Entry {
    readonly token: symbol;
    readonly descriptor: RegionDescriptor;
    readonly reporter: Reporter;
    visible: boolean;
  }
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let closed = false;
  const notify = () => {
    for (const listener of listeners) listener();
  };

  const stamp = () => new Date(deps.now()).toISOString();
  const failure = (
    outcome: QueryFailure,
    regionId: string,
    extra: { readonly supportedSchemaVersion?: number } = {},
  ): QueryReply => ({
    ok: false,
    outcome,
    clientId: deps.clientId,
    regionId,
    capturedAt: stamp(),
    ...extra,
  });

  const readTokenValue = (name: string): TokenReading => {
    try {
      const value = deps.readToken(name)?.trim();
      return value === undefined || value === ""
        ? { name, status: "omitted", reason: "unavailable" }
        : { name, status: "value", value };
    } catch {
      return { name, status: "omitted", reason: "unavailable" };
    }
  };

  return {
    clientId: deps.clientId,
    register(descriptor, reporter, options) {
      if (closed) return () => {};
      const entry: Entry = {
        token: Symbol(descriptor.id),
        descriptor,
        reporter,
        visible: options?.visible ?? true,
      };
      entries.set(descriptor.id, entry);
      notify();
      return () => {
        if (entries.get(descriptor.id)?.token !== entry.token) return;
        entries.delete(descriptor.id);
        notify();
      };
    },
    setVisible(regionId, visible) {
      const entry = entries.get(regionId);
      if (entry === undefined || entry.visible === visible) return;
      entry.visible = visible;
      notify();
    },
    snapshot() {
      return {
        clientId: deps.clientId,
        regions: [...entries.values()]
          .toSorted((a, b) => (a.descriptor.id < b.descriptor.id ? -1 : 1))
          .map((entry) => ({ descriptor: entry.descriptor, visible: entry.visible })),
      };
    },
    query(regionId, options) {
      const entry = entries.get(regionId);
      if (entry === undefined) return failure("region-not-found", regionId);
      const { descriptor } = entry;
      const wanted = options?.schemaVersion;
      if (wanted !== undefined && wanted !== descriptor.schemaVersion)
        return failure("schema-unsupported", regionId, {
          supportedSchemaVersion: descriptor.schemaVersion,
        });
      let reported: ReturnType<Reporter>;
      try {
        reported = entry.reporter();
      } catch {
        return failure("unavailable", regionId);
      }
      if (!isObject(reported)) return failure("unavailable", regionId);
      const { props, state } = reported;
      return {
        ok: true,
        clientId: deps.clientId,
        regionId,
        schemaVersion: descriptor.schemaVersion,
        capturedAt: stamp(),
        props: descriptor.props.map((field) =>
          readField(field, isObject(props) ? props : undefined),
        ),
        state: descriptor.state.map((field) =>
          readField(field, isObject(state) ? state : undefined),
        ),
        tokens: descriptor.tokens.map(readTokenValue),
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      const had = entries.size > 0;
      closed = true;
      entries.clear();
      if (had) notify();
    },
  };
}

/** The page's own token reader: the live value from the root element's computed style. Absent outside a document. */
export const readComputedToken = (name: string): string | undefined =>
  typeof document === "undefined"
    ? undefined
    : getComputedStyle(document.documentElement).getPropertyValue(name);
