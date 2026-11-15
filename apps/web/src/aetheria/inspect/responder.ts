// AETHERIA M11 Plan step 21 (C6 U3; D9–D12) — the page's live responder: it listens on the Backend's request stream for this connection, answers each request from the page's own registry and sends ONLY the correlated
// reply. It starts no inspection, runs no business action and sends nothing unasked.
//
// Lifetime. One generation per connection: `rebind` (a new connection) and `stop` (unmount) end the old one, so a request received before and answered after — a late callback — is never sent through the replacement
// connection or after the page left. The page keeps no deadline of its own: a request carries the time left and the Backend ends the query at D, so a reconnect restarts nothing. Nothing is stored after a reply.
import type { InspectClientRequest, InspectReplyPayload } from "@t3tools/aetheria-contracts";

import { answerRequest, type AnswerSources } from "./answer";

export interface ResponderTransport {
  /** Starts listening for this connection's requests; the returned function stops it. */
  subscribe(onRequest: (request: InspectClientRequest) => void): () => void;
  /** Sends one reply. A rejection means it did not arrive; nothing retries it. */
  reply(payload: InspectReplyPayload): Promise<unknown>;
}

export interface Responder {
  start(): void;
  /** A new connection: the old request stream is released, a new one bound, and answers still owed to the old one are dropped. */
  rebind(): void;
  /** Unmount: stop listening and drop everything owed. */
  stop(): void;
}

export function createResponder(
  deps: AnswerSources & { readonly transport: ResponderTransport },
): Responder {
  let generation = 0;
  let stopped = true;
  let release: (() => void) | undefined;

  const bind = () => {
    release?.();
    generation += 1;
    const mine = generation;
    release = deps.transport.subscribe((request) => {
      if (stopped || mine !== generation) return;
      let payload: InspectReplyPayload;
      try {
        payload = answerRequest(request, deps);
      } catch {
        payload = { requestId: request.requestId, outcome: "unavailable" };
      }
      // The answer is built synchronously; the check stays so a transport that delivers late is still dropped.
      if (stopped || mine !== generation) return;
      void deps.transport.reply(payload).catch(() => undefined);
    });
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      bind();
    },
    rebind() {
      if (stopped) return;
      bind();
    },
    stop() {
      stopped = true;
      generation += 1;
      release?.();
      release = undefined;
    },
  };
}
