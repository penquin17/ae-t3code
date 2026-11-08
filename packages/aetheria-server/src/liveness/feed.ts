// AETHERIA — drives a liveness service from T3's stored domain events, handed in as an async iterable; imports neither Effect nor the server.
// A stream that ends or fails is a missed observation for every holder: they become `unknown`, because a run or an exit may have happened unseen.
// Nothing here retries or reconnects; the owner of the subscription decides.
import type { LivenessInputEvent, LivenessService } from "./service.ts";

export type LivenessFeedOutcome = { readonly ended: "completed" } | { readonly ended: "failed" };

export async function consumeLivenessStream(
  service: LivenessService,
  source: AsyncIterable<LivenessInputEvent>,
): Promise<LivenessFeedOutcome> {
  try {
    for await (const event of source) service.ingest(event);
  } catch {
    service.noteGap("feed-failed");
    return { ended: "failed" };
  }
  service.noteGap("feed-ended");
  return { ended: "completed" };
}
