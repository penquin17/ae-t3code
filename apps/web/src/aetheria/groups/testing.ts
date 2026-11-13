// A fake Backend group store for the tests: DSH's set-operation semantics over one in-memory record, with
// scripted faults. It shows what the web side does with such replies; it is not a real Backend and proves
// nothing about the real store, its file, its RPC or its limits. Not imported by production code.
import type { GroupBody } from "./operations";
import type { GroupRecord } from "./record";
import type { GroupsReply, GroupsTransport } from "./transport";

export type ApplyFault =
  | "throw-before"
  | "throw-after"
  | "lie"
  | "garbage"
  | { readonly refuse: string; readonly detail?: string }
  | { readonly reply: GroupsReply };
export type ReadFault = "throw" | "garbage" | { readonly reply: GroupsReply };

export const emptyRecord: GroupRecord = { version: 2, links: [], dismissed: [], names: [] };

const ascending = (l: string, r: string): number => (l < r ? -1 : l > r ? 1 : 0);

/** DSH's operation rules (groups-types.ts and docs/dsh/aetheria-ui.md): sets, sorted, idempotent. */
function applyToRecord(record: GroupRecord, body: GroupBody, at: number): GroupRecord {
  switch (body.op) {
    case "group":
      return record.links.some((l) => l.a === body.a && l.b === body.b)
        ? record
        : { ...record, links: [...record.links, { a: body.a, b: body.b, kind: "grouped", at }] };
    case "ungroup":
      return { ...record, links: record.links.filter((l) => !(l.a === body.a && l.b === body.b)) };
    case "dismiss":
      return record.dismissed.some((p) => p.a === body.a && p.b === body.b)
        ? record
        : { ...record, dismissed: [...record.dismissed, { a: body.a, b: body.b, at }] };
    case "detach":
      return { ...record, links: record.links.filter((l) => l.a !== body.a && l.b !== body.a) };
    case "rename": {
      const members = [...new Set(body.members)].toSorted(ascending);
      const same = record.names.some(
        (n) => n.name === body.name && JSON.stringify(n.members) === JSON.stringify(members),
      );
      if (same) return record;
      const kept = record.names.filter((n) => !n.members.some((id) => members.includes(id)));
      return {
        ...record,
        names: body.name === "" ? kept : [...kept, { members, name: body.name, at }],
      };
    }
  }
}

export interface FakeBackend {
  readonly transport: GroupsTransport;
  /** The Backend's own record: what a test compares the web side against. */
  record(): GroupRecord;
  set(record: GroupRecord): void;
  readonly applyFaults: ApplyFault[];
  readonly readFaults: ReadFault[];
  /** Every read and apply that reached the Backend, in order. */
  readonly events: string[];
  readonly bodies: GroupBody[];
  /** Holds the next apply until the returned function is called. */
  holdNextApply(): () => void;
}

export function createFakeBackend(initial: GroupRecord = emptyRecord): FakeBackend {
  let record = initial;
  let clock = 1000;
  let release: (() => void) | undefined;
  let hold: Promise<void> | undefined;
  const backend: FakeBackend = {
    record: () => record,
    set: (next) => {
      record = next;
    },
    applyFaults: [],
    readFaults: [],
    events: [],
    bodies: [],
    holdNextApply: () => {
      hold = new Promise<void>((resolve) => (release = resolve));
      return () => release?.();
    },
    transport: {
      async read() {
        backend.events.push("read");
        const fault = backend.readFaults.shift();
        if (fault === "throw") throw new Error("socket closed");
        if (fault === "garbage") return { ok: true, value: { version: 9 } };
        if (fault !== undefined) return fault.reply;
        return { ok: true, value: record };
      },
      async apply(body) {
        backend.events.push(`apply:${body.op}`);
        backend.bodies.push(body);
        const pending = hold;
        hold = undefined;
        if (pending !== undefined) await pending;
        const fault = backend.applyFaults.shift();
        if (fault === "throw-before") throw new Error("socket closed");
        if (typeof fault === "object" && "refuse" in fault) {
          return {
            ok: false,
            code: fault.refuse,
            ...(fault.detail === undefined ? {} : { detail: fault.detail }),
          };
        }
        if (typeof fault === "object" && "reply" in fault) return fault.reply;
        if (fault === "lie") return { ok: true, value: record };
        if (fault === "garbage") return { ok: true, value: "yes" };
        clock += 1;
        record = applyToRecord(record, body, clock);
        if (fault === "throw-after") throw new Error("socket closed after the write");
        return { ok: true, value: record };
      },
    },
  };
  return backend;
}
