// Unsent drafts for the human-control cards (D14, C7). A draft is keyed by (sessionId, interactionId, revision): text typed against one revision is never submitted against another.
// It lives in memory and, behind `DraftStorage`, in `sessionStorage` so a reload or reconnect restores it. A superseded revision's draft is readable, labelled as "earlier", and never current.
// A draft is cleared only when the caller says the Backend confirmed the action (never on send). A storage that fails degrades to memory without losing the text. Plain TypeScript.

export interface DraftKey {
  readonly sessionId: string;
  readonly interactionId: string;
  readonly revision: string;
}

/** The subset of `Storage` this needs, with key enumeration so earlier revisions can be found. */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export type DraftRead =
  | { readonly status: "current"; readonly value: string }
  | { readonly status: "earlier"; readonly value: string; readonly revision: string }
  | { readonly status: "none" };

export interface DraftStore {
  read(key: DraftKey): DraftRead;
  write(key: DraftKey, value: string): void;
  /** After the Backend confirmed: removes every revision's draft of this interaction. */
  clear(key: DraftKey): void;
  /** True once a storage call failed: drafts then live in memory only. */
  degraded(): boolean;
}

const PREFIX = "aetheria:control-draft:";
const part = (text: string) => encodeURIComponent(text);
const prefixOf = (key: Pick<DraftKey, "sessionId" | "interactionId">) =>
  `${PREFIX}${part(key.sessionId)}:${part(key.interactionId)}:`;
const storageKeyOf = (key: DraftKey) => `${prefixOf(key)}${key.revision}`;

interface Entry {
  readonly value: string;
  readonly at: number;
}

const parseEntry = (text: string | null): Entry | null => {
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as Partial<Entry> | null;
    return parsed !== null &&
      typeof parsed === "object" &&
      typeof parsed.value === "string" &&
      typeof parsed.at === "number"
      ? { value: parsed.value, at: parsed.at }
      : null;
  } catch {
    return null;
  }
};

export function createDraftStore(
  storage: DraftStorage | null,
  options: { readonly now?: () => number } = {},
): DraftStore {
  const now = options.now ?? Date.now;
  const memory = new Map<string, Entry>();
  let failed = false;

  const guarded = <T>(run: (s: DraftStorage) => T, otherwise: T): T => {
    if (storage === null) return otherwise;
    try {
      return run(storage);
    } catch {
      failed = true;
      return otherwise;
    }
  };

  /** Every entry of this interaction, memory first and storage behind it. */
  const entriesOf = (key: Pick<DraftKey, "sessionId" | "interactionId">) => {
    const prefix = prefixOf(key);
    const found = new Map<string, Entry>();
    for (const [name, entry] of memory) if (name.startsWith(prefix)) found.set(name, entry);
    const names = guarded((s) => s.keys(), [] as string[]);
    for (const name of names) {
      if (!name.startsWith(prefix) || found.has(name)) continue;
      const entry = parseEntry(guarded((s) => s.getItem(name), null));
      if (entry !== null) found.set(name, entry);
    }
    return { prefix, found };
  };

  return {
    read(key) {
      const { prefix, found } = entriesOf(key);
      const current = found.get(storageKeyOf(key));
      if (current !== undefined) return { status: "current", value: current.value };
      let latest: { name: string; entry: Entry } | null = null;
      for (const [name, entry] of found) {
        if (latest === null || entry.at > latest.entry.at) latest = { name, entry };
      }
      return latest === null
        ? { status: "none" }
        : {
            status: "earlier",
            value: latest.entry.value,
            revision: latest.name.slice(prefix.length),
          };
    },
    write(key, value) {
      const entry = { value, at: now() };
      memory.set(storageKeyOf(key), entry);
      guarded((s) => s.setItem(storageKeyOf(key), JSON.stringify(entry)), undefined);
    },
    clear(key) {
      const { found } = entriesOf(key);
      for (const name of found.keys()) {
        memory.delete(name);
        guarded((s) => s.removeItem(name), undefined);
      }
    },
    degraded: () => failed,
  };
}

/** The browser's `sessionStorage` as a draft storage, or `null` when the page cannot reach it. */
export function browserDraftStorage(): DraftStorage | null {
  try {
    const storage = window.sessionStorage;
    return {
      getItem: (k) => storage.getItem(k),
      setItem: (k, v) => storage.setItem(k, v),
      removeItem: (k) => storage.removeItem(k),
      keys: () =>
        Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
          (k): k is string => k !== null,
        ),
    };
  } catch {
    return null;
  }
}
