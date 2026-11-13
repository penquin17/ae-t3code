// The owner of every file action on a page (M10 Plan step 16, C5/C6): one save slot and one preview slot per item, each holding only the last answer of its newest request. A request is a GET of the
// Backend's own bytes by id (`deliverables/download.ts`); nothing is edited before it answers, a stale answer lands nowhere, and an object URL made for a preview is revoked when the preview is
// replaced, closed, or the page goes away. A refusal is shown in the Backend's code and words; nothing here retries.
import type { DeliverableKind } from "@t3tools/aetheria-contracts";
import { useEffect, useRef, useState } from "react";

import { compareDigest, type DigestComparison, type Semantics } from "../deliverables/model";
import type { DownloadResult } from "../deliverables/download";
import { useDeliverableFetcher } from "./fetcher";
import { mimeFor, previewPlan, TEXT_PREVIEW_LIMIT } from "./preview";

/** What one file action is about. `declaredDigest` is null for an offered edit path: it carries no declared digest, so nothing is compared. */
export interface FetchTarget {
  readonly id: string;
  /** An offered path names its root. */
  readonly rootThreadId?: string;
  readonly semantics: Semantics;
  readonly filename: string;
  /** The Backend's path, used only to pick the blob's type. */
  readonly path: string;
  readonly kind: DeliverableKind;
  /** The size at declaration, or null when unknown. */
  readonly size: number | null;
  readonly declaredDigest: string | null;
}

export type Problem =
  | {
      readonly tag: "refused";
      readonly status: number;
      readonly code: string;
      readonly detail?: string;
      readonly known: boolean;
    }
  | { readonly tag: "no-credential"; readonly reason: string }
  | { readonly tag: "failed"; readonly reason: string }
  | { readonly tag: "not-previewable"; readonly reason: string };

export type SaveState =
  | { readonly tag: "idle" }
  | { readonly tag: "working"; readonly semantics: Semantics }
  | {
      readonly tag: "saved";
      readonly semantics: Semantics;
      readonly filename: string;
      readonly size: number;
      readonly comparison: DigestComparison | null;
    }
  | { readonly tag: "problem"; readonly semantics: Semantics; readonly problem: Problem };

export type PreviewContent =
  | { readonly mode: "text" | "markdown"; readonly text: string }
  | { readonly mode: "html" | "pdf"; readonly url: string }
  | { readonly mode: "image" | "audio" | "video"; readonly url: string };

export type PreviewState =
  | { readonly tag: "idle" }
  | { readonly tag: "working"; readonly semantics: Semantics }
  | {
      readonly tag: "open";
      readonly semantics: Semantics;
      readonly content: PreviewContent;
      readonly comparison: DigestComparison | null;
    }
  | { readonly tag: "problem"; readonly semantics: Semantics; readonly problem: Problem };

const IDLE = { tag: "idle" } as const;

const problemOf = (result: Exclude<DownloadResult, { readonly tag: "bytes" }>): Problem =>
  result.tag === "refused"
    ? {
        tag: "refused",
        status: result.status,
        code: result.code,
        known: result.known,
        ...(result.detail === undefined ? {} : { detail: result.detail }),
      }
    : result;

const comparisonOf = (target: FetchTarget, digest: string | null): DigestComparison | null =>
  target.declaredDigest === null ? null : compareDigest(target.declaredDigest, digest);

export interface Fetches {
  readonly saveOf: (id: string) => SaveState;
  readonly previewOf: (id: string) => PreviewState;
  readonly save: (target: FetchTarget) => void;
  readonly preview: (target: FetchTarget) => void;
  readonly closePreview: (id: string) => void;
}

export function useFetches(environmentId: string): Fetches {
  const fetcher = useDeliverableFetcher();
  const [saves, setSaves] = useState<Readonly<Record<string, SaveState>>>({});
  const [previews, setPreviews] = useState<Readonly<Record<string, PreviewState>>>({});
  const tickets = useRef(new Map<string, number>());
  const urls = useRef(new Map<string, string>());

  const nextTicket = (slot: string): number => {
    const ticket = (tickets.current.get(slot) ?? 0) + 1;
    tickets.current.set(slot, ticket);
    return ticket;
  };
  const current = (slot: string, ticket: number): boolean => tickets.current.get(slot) === ticket;
  const revoke = (id: string): void => {
    const url = urls.current.get(id);
    if (url !== undefined) URL.revokeObjectURL(url);
    urls.current.delete(id);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- disposal: every object URL still held is revoked when the page goes away, and an answer that arrives later lands nowhere
  useEffect(() => {
    const held = urls.current;
    const slots = tickets.current;
    return () => {
      for (const url of held.values()) URL.revokeObjectURL(url);
      held.clear();
      for (const slot of slots.keys()) slots.set(slot, (slots.get(slot) ?? 0) + 1);
    };
  }, []);

  async function save(target: FetchTarget): Promise<void> {
    const slot = `save:${target.id}`;
    const ticket = nextTicket(slot);
    setSaves((all) => ({ ...all, [target.id]: { tag: "working", semantics: target.semantics } }));
    const result = await fetcher.fetch(environmentId, {
      id: target.id,
      semantics: target.semantics,
      ...(target.rootThreadId === undefined ? {} : { rootThreadId: target.rootThreadId }),
    });
    if (!current(slot, ticket)) return;
    if (result.tag !== "bytes") {
      setSaves((all) => ({
        ...all,
        [target.id]: { tag: "problem", semantics: target.semantics, problem: problemOf(result) },
      }));
      return;
    }
    fetcher.save(result.blob, target.filename);
    setSaves((all) => ({
      ...all,
      [target.id]: {
        tag: "saved",
        semantics: target.semantics,
        filename: target.filename,
        size: result.blob.size,
        comparison: comparisonOf(target, result.digest),
      },
    }));
  }

  async function preview(target: FetchTarget): Promise<void> {
    const slot = `preview:${target.id}`;
    const ticket = nextTicket(slot);
    const plan = previewPlan(target.kind, target.size ?? 0);
    revoke(target.id);
    if (plan.mode === "download-only") {
      setPreviews((all) => ({
        ...all,
        [target.id]: {
          tag: "problem",
          semantics: target.semantics,
          problem: { tag: "not-previewable", reason: plan.reason },
        },
      }));
      return;
    }
    setPreviews((all) => ({
      ...all,
      [target.id]: { tag: "working", semantics: target.semantics },
    }));
    const result = await fetcher.fetch(environmentId, {
      id: target.id,
      semantics: target.semantics,
      ...(target.rootThreadId === undefined ? {} : { rootThreadId: target.rootThreadId }),
    });
    if (!current(slot, ticket)) return;
    if (result.tag !== "bytes") {
      setPreviews((all) => ({
        ...all,
        [target.id]: { tag: "problem", semantics: target.semantics, problem: problemOf(result) },
      }));
      return;
    }
    const comparison = comparisonOf(target, result.digest);
    let content: PreviewContent;
    if (plan.mode === "text" || plan.mode === "markdown") {
      if (result.blob.size > TEXT_PREVIEW_LIMIT) {
        setPreviews((all) => ({
          ...all,
          [target.id]: {
            tag: "problem",
            semantics: target.semantics,
            problem: {
              tag: "not-previewable",
              reason: "The file is larger than the preview limit (1 MiB); download it.",
            },
          },
        }));
        return;
      }
      const text = await result.blob.text();
      if (!current(slot, ticket)) return;
      content = { mode: plan.mode, text };
    } else {
      const url = URL.createObjectURL(
        new Blob([result.blob], { type: mimeFor(target.path, target.kind) }),
      );
      urls.current.set(target.id, url);
      content = { mode: plan.mode, url };
    }
    setPreviews((all) => ({
      ...all,
      [target.id]: { tag: "open", semantics: target.semantics, content, comparison },
    }));
  }

  return {
    saveOf: (id) => saves[id] ?? IDLE,
    previewOf: (id) => previews[id] ?? IDLE,
    save: (target) => void save(target),
    preview: (target) => void preview(target),
    closePreview: (id) => {
      nextTicket(`preview:${id}`);
      revoke(id);
      setPreviews((all) => ({ ...all, [id]: IDLE }));
    },
  };
}
