// The write guard of T3's terminal drawer (M10 Plan steps 15–16; the step-15 verdict "a write to an exited terminal reports success while delivering nothing"; integration point IP-61).
//
// T3's server answers a write to an exited terminal with success and delivers it to no process. The drawer already knows the session's status, so it can say so instead of letting typing look
// delivered. This module owns the one rule: given the status the drawer has seen, is the input refused here, and what is the person told. The guard is per drawer surface and remembers only
// whether it has told for the current ended state, so a held key does not print a line per keystroke. It owns no session state: the caller passes the status it read.

/** What a person is told when they type into a terminal whose process has exited. */
export const ENDED_WRITE_EXITED =
  "Process exited: your input was not delivered. Close this terminal and open a new one.";
/** What a person is told when they type into a terminal that has been closed. */
export const ENDED_WRITE_CLOSED =
  "Terminal closed: your input was not delivered. Open a new terminal.";

/** The part of the drawer's session state the guard reads (T3's TerminalSessionState status and version). */
export interface EndedWriteSession {
  readonly status: string;
  readonly version: number;
}

type Ended = "exited" | "closed";
const endedOf = (session: EndedWriteSession): Ended | null =>
  // Version 0 is the state before the first answer: nothing is known, so T3's own path decides.
  session.version > 0 && (session.status === "exited" || session.status === "closed")
    ? session.status
    : null;

export interface EndedWriteGuard {
  /** Whether input must not be sent (the process has exited or the terminal is closed). */
  readonly blocks: (session: EndedWriteSession) => boolean;
  /** The words to show for this write, or null: the input is allowed, or the person was already told for this ended state. */
  readonly check: (session: EndedWriteSession) => string | null;
}

export function createEndedWriteGuard(): EndedWriteGuard {
  let told: Ended | null = null;
  return {
    blocks: (session) => endedOf(session) !== null,
    check(session) {
      const ended = endedOf(session);
      if (ended === null) {
        told = null;
        return null;
      }
      if (told === ended) return null;
      told = ended;
      return ended === "exited" ? ENDED_WRITE_EXITED : ENDED_WRITE_CLOSED;
    },
  };
}
