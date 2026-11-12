// Folds: which projects, sections and groups the user has opened or closed. Browser-local view
// memory (the group store never holds it). A storage that fails never stops in-page folding.

import type { SessionState } from "./types";

export const FOLDS_STORAGE_KEY = "aetheria-ui:folds";

export type Folds = Readonly<Record<string, boolean>>;

export interface FoldStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const foldKey = {
  project: (projectId: string) => `project:${projectId}`,
  section: (projectId: string, state: SessionState) => `section:${projectId}:${state}`,
  pinned: (projectId: string) => `section:${projectId}:pinned`,
  groups: (projectId: string) => `section:${projectId}:groups`,
  group: (projectId: string, groupKey: string) => `group:${projectId}:${groupKey}`,
} as const;

/** A saved value wins over the default; a search draws a node open without saving. */
export function resolveOpen(
  saved: Folds,
  key: string,
  defaultOpen: boolean,
  forcedOpen: boolean,
): boolean {
  if (forcedOpen) return true;
  return saved[key] ?? defaultOpen;
}

/** `ok` is false when the stored record was missing-but-unreadable, corrupt or not a boolean map. */
export function readFolds(storage: FoldStorage): { ok: boolean; folds: Folds } {
  let raw: string | null;
  try {
    raw = storage.getItem(FOLDS_STORAGE_KEY);
  } catch {
    return { ok: false, folds: {} };
  }
  if (raw === null) return { ok: true, folds: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, folds: {} };
    }
    const entries = Object.entries(parsed);
    if (!entries.every(([, value]) => typeof value === "boolean")) return { ok: false, folds: {} };
    return { ok: true, folds: Object.fromEntries(entries) as Folds };
  } catch {
    return { ok: false, folds: {} };
  }
}

/** Returns false when the write failed; the caller keeps folding in memory. */
export function writeFolds(storage: FoldStorage, folds: Folds): boolean {
  try {
    storage.setItem(FOLDS_STORAGE_KEY, JSON.stringify(folds));
    return true;
  } catch {
    return false;
  }
}
