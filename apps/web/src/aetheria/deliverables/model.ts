// What a root's deliverables are, as the Backend says (M10 Plan step 16, D9/D10, C5). Plain TypeScript over supplied replies: no T3, no DOM. A reply that is not a list is unknown, never an empty
// list; a Backend failure keeps its code and words; a card shows only what the Backend declared; the digest comparison says what was compared and never that bytes were re-hashed here.
import {
  ClientDeliverablesListResult,
  DELIVERABLES_CLIENT_CODE_CLASSES,
  type DeliverableCard,
  type DeliverableKind,
} from "@t3tools/aetheria-contracts";
import * as Schema from "effect/Schema";

import type { SendResult } from "../core/outcome";
import { lineForCode, SNAPSHOT_FAILURE_LINES } from "./words";

export type Semantics = "current" | "as-delivered";

/** What one read said. `reading` (before the first answer) belongs to the read state, not to this view. */
export type ListView =
  | {
      readonly tag: "known";
      readonly rootThreadId: string;
      readonly cards: readonly DeliverableCard[];
    }
  | { readonly tag: "refused"; readonly code: string; readonly detail?: string }
  | {
      readonly tag: "unavailable";
      readonly reason: string;
      readonly code?: string;
      readonly detail?: string;
    }
  | { readonly tag: "unknown"; readonly reason: string };

/** A failure view: shared by every client read of this step, so a code is judged in one place. */
export type FailureView = Exclude<ListView, { readonly tag: "known" }>;

const isClientCode = (code: string): code is keyof typeof DELIVERABLES_CLIENT_CODE_CLASSES =>
  Object.hasOwn(DELIVERABLES_CLIENT_CODE_CLASSES, code);

/** A Backend failure reply as a view: a `failure`-class code is unavailable, a refusal or absence is refused. An unknown code is refused, its words kept. */
export function failureFromBackend(code: string, detail: string | undefined): FailureView {
  const kept = detail === undefined ? {} : { detail };
  if (isClientCode(code) && DELIVERABLES_CLIENT_CODE_CLASSES[code] === "failure") {
    return {
      tag: "unavailable",
      code,
      reason: lineForCode(code) ?? detail ?? "The Backend could not answer.",
      ...kept,
    };
  }
  return { tag: "refused", code, ...kept };
}

/** A send that did not bring a Backend reply: T3's refusal, a lost reply, or no client. `what` completes "…so the <what> was not read". */
export function failureFromSend(
  send: Exclude<SendResult<unknown>, { readonly tag: "accepted" }>,
  what: string,
): FailureView {
  switch (send.tag) {
    case "lost":
      return { tag: "unknown", reason: `the reply never arrived, so the ${what} was not read` };
    case "unavailable":
      return { tag: "unavailable", reason: send.reason };
    case "refused":
      return { tag: "refused", code: send.code, detail: send.message };
  }
}

const decodeList = Schema.decodeUnknownSync(ClientDeliverablesListResult);

const NOT_A_LIST = "the Backend's answer was not a deliverables list";

/** One Backend answer to `aetheria.deliverables.list` for `rootThreadId` as one view. An answer for another root is unknown for this one. */
export function listViewFromSend(send: SendResult<unknown>, rootThreadId: string): ListView {
  if (send.tag !== "accepted") return failureFromSend(send, "deliverables");
  let result: ClientDeliverablesListResult;
  try {
    result = decodeList(send.value);
  } catch {
    return { tag: "unknown", reason: NOT_A_LIST };
  }
  if (!result.ok) return failureFromBackend(result.code, result.detail);
  if (result.value.rootThreadId !== rootThreadId) {
    return { tag: "unknown", reason: "the Backend's answer was for another session" };
  }
  return { tag: "known", rootThreadId, cards: result.value.deliverables };
}

const KIND_TEXT: Record<DeliverableKind, string> = {
  text: "Text",
  markdown: "Markdown",
  html: "HTML",
  pdf: "PDF",
  image: "Image",
  audio: "Audio",
  video: "Video",
  office: "Office document",
  other: "Other file",
};
const kindText = (kind: DeliverableKind): string => KIND_TEXT[kind];

const UNITS = ["KiB", "MiB", "GiB"] as const;
/** A size in bytes: whole bytes below 1 KiB, otherwise one decimal in the largest unit that keeps it at least 1. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** A declaration time in UTC, to the minute: the same words on every machine. */
export function declaredText(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export interface CardFacts {
  readonly title: string;
  readonly kindText: string;
  readonly sizeText: string;
  readonly declaredText: string;
  readonly turnText: string;
  /** The Backend's path, a label only: it is never a local path and never opens anything. */
  readonly pathText: string;
  /** Set when the delivery came from a session other than the root. */
  readonly sessionText: string | null;
  readonly supersededText: string | null;
  readonly snapshot: { readonly tag: "kept" | "none" | "pending"; readonly text: string };
}

export function cardFacts(card: DeliverableCard, rootThreadId: string): CardFacts {
  const snapshot = card.snapshot;
  return {
    title: card.title,
    kindText: kindText(card.kind),
    sizeText: humanSize(card.size),
    declaredText: declaredText(card.declaredAt),
    turnText: `Turn ${card.turnId}`,
    pathText: card.canonicalPath,
    sessionText: card.threadId === rootThreadId ? null : `From session ${card.threadId}`,
    supersededText: card.supersededBy === null ? null : "Replaced by a later version",
    snapshot:
      snapshot.state === "attached"
        ? {
            tag: "kept",
            text: `Copy kept (as delivered, ${humanSize(snapshot.size)})`,
          }
        : snapshot.state === "unavailable"
          ? {
              tag: "none",
              text: `No copy kept: ${SNAPSHOT_FAILURE_LINES[snapshot.code]} (${snapshot.code})`,
            }
          : { tag: "pending", text: "Copy not settled yet" },
  };
}

/** The current file is always offered; the as-delivered copy only when one is kept. */
export function semanticsOffered(card: DeliverableCard): readonly Semantics[] {
  return card.snapshot.state === "attached" ? ["current", "as-delivered"] : ["current"];
}

export type DigestComparison =
  | { readonly tag: "same" }
  | { readonly tag: "differs"; readonly declared: string; readonly reported: string }
  | { readonly tag: "not-reported" };

/** The digest the Backend reported for the bytes it sent, against the one declared at delivery. */
export function compareDigest(declared: string, reported: string | null): DigestComparison {
  if (reported === null) return { tag: "not-reported" };
  return reported === declared ? { tag: "same" } : { tag: "differs", declared, reported };
}

const NOT_REHASHED =
  " (Compared with the digest the Backend reported; bytes not re-hashed in the browser.)";

/** One honest sentence for a comparison. A differing current file is the "changed since delivered" marker; a differing copy is a warning, not a marker. */
export function comparisonText(semantics: Semantics, comparison: DigestComparison): string {
  if (comparison.tag === "not-reported") {
    return "The Backend reported no digest for these bytes, so nothing was compared.";
  }
  if (semantics === "current") {
    return comparison.tag === "same"
      ? `The current file matches the digest declared when it was delivered.${NOT_REHASHED}`
      : `Changed since delivered: the current file's digest differs from the one declared.${NOT_REHASHED}`;
  }
  return comparison.tag === "same"
    ? `The copy matches the digest declared when it was delivered.${NOT_REHASHED}`
    : `The copy's digest does not match the one declared; do not rely on it.${NOT_REHASHED}`;
}

/** Newest declaration first; the list the Backend gave is not changed. */
export function displayOrder(cards: readonly DeliverableCard[]): readonly DeliverableCard[] {
  return cards.toSorted((a, b) => b.declaredAt - a.declaredAt);
}
