// The terminal words that need no T3 edit (M10 Plan step 16, D13). T3's terminal drawer is a chat-view component: it needs the conversation's right-panel surface, project and composer state, so it
// cannot be mounted from an Aetheria route without editing T3. The Plan's fallback is recorded here as a visible statement, and the authority label is shown where terminals are mentioned.

/** Who a terminal runs as (D13). */
export const TERMINAL_AUTHORITY =
  "Commands in a terminal run as the Backend user, outside the agent's permissions.";

/** Where the terminal is, since this build does not mount it. */
export const TERMINAL_NOT_MOUNTED =
  "Terminal page not mounted; T3's own drawer remains the terminal surface.";
