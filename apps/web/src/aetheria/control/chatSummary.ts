// What the chat says about the requests the Backend holds open for the session: which ones get a card above the message box, and the banner's words. Plain TypeScript.
import { isOpen } from "./recordText";
import type { InteractionRecord } from "./types";

export interface ChatSummary {
  /** Open requests that are not held, in the order the Backend listed them. */
  readonly cards: InteractionRecord[];
  readonly title: string;
  readonly description: string;
}

const SINGLE_TITLE = {
  question: "A question is waiting for you",
  "plan-review": "A plan review is waiting for you",
  authorization: "An authorization request is waiting for you",
} as const;

/** `null` when nothing is open. A held request gets no card (it waits on the control page) but is counted in the banner. */
export function chatSummary(records: readonly InteractionRecord[]): ChatSummary | null {
  const open = records.filter(isOpen);
  if (open.length === 0) return null;
  const cards = open.filter((record) => record.held !== true);
  const held = open.length - cards.length;
  const [only] = cards;
  const title =
    cards.length === 0
      ? `${held} held ${held === 1 ? "request" : "requests"}`
      : only !== undefined && cards.length === 1
        ? SINGLE_TITLE[only.kind]
        : `${cards.length} requests are waiting for you`;
  const description = `${held > 0 ? `${held} held. ` : ""}Answer here or on the Human control page.`;
  return { cards, title, description };
}
