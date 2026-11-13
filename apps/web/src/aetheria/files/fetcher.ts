// The two capabilities a file action needs (M10 Plan step 16, D7): fetch the bytes of an offered or declared id with the environment's Bearer credential (or, when it holds none, T3's own same-origin session), and hand a blob to the person as a saved
// file. Production reads the connection T3 prepared for that environment at the moment of the call (never a stored copy of the credential) and uses the page's `fetch`; a test supplies both.
import { EnvironmentId } from "@t3tools/contracts";
import { createContext, use } from "react";

import { readPreparedConnection } from "../../state/session";
import {
  fetchDeliverable,
  type DownloadRequest,
  type DownloadResult,
} from "../deliverables/download";
import { saveBlob } from "./save";

export interface DeliverableFetcher {
  readonly fetch: (environmentId: string, request: DownloadRequest) => Promise<DownloadResult>;
  readonly save: (blob: Blob, filename: string) => void;
}

const productionFetcher: DeliverableFetcher = {
  fetch: (environmentId, request) =>
    fetchDeliverable(
      {
        fetch: (input, init) => globalThis.fetch(input, init),
        connection: readPreparedConnection(EnvironmentId.make(environmentId)),
      },
      request,
    ),
  save: saveBlob,
};

/** Absent in production; a test provides fakes here. */
export const DeliverableFetcherContext = createContext<DeliverableFetcher | null>(null);

export const useDeliverableFetcher = (): DeliverableFetcher =>
  use(DeliverableFetcherContext) ?? productionFetcher;
