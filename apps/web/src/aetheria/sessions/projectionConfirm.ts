import type { ConfirmResult } from "../core/outcome";

/** What the session actions read of a thread in T3's projection (a subset of its thread shell). */
export interface ShellProjection {
  readonly title: string;
  readonly pinnedAt?: string | null;
}

/** Whether the projection of one thread shows an action's result; `null` is a thread not in the projection. */
export type ShellMatch = (shell: ShellProjection | null) => boolean;

/** Resolves true once the thread's projection matches, false when the bounded wait ends first. May throw. */
export type WaitForShell = (matches: ShellMatch) => Promise<boolean>;

/** The projection's title is the requested one (edge spaces ignored, as T3 stores a trimmed title). */
export const shellTitled =
  (title: string): ShellMatch =>
  (shell) =>
    shell !== null && shell.title.trim() === title.trim();

/** The projection carries the pin state asked for. A missing thread shows neither. */
export const shellPinned =
  (pinned: boolean): ShellMatch =>
  (shell) =>
    shell !== null && (shell.pinnedAt != null) === pinned;

/** T3 keeps an archived thread out of its active projection, so only its absence shows an archive. */
export const shellArchived: ShellMatch = (shell) => shell === null;

/**
 * Reads the projection back for one accepted action. `shows` only when it matches within the wait,
 * `absent` when the wait ends without a match, `failed` (with the reason) when the read itself fails.
 */
export async function confirmShell(
  wait: WaitForShell,
  matches: ShellMatch,
): Promise<ConfirmResult> {
  try {
    return (await wait(matches)) ? { tag: "shows" } : { tag: "absent" };
  } catch (error) {
    return {
      tag: "failed",
      reason: error instanceof Error ? error.message : "the projection could not be read",
    };
  }
}
