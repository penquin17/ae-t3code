// The authorized download (M10 Plan step 16, D7/D10): one `GET` to step 14's route with the connection's Bearer header, or, when the connection holds none (T3's own signed-in session), the page's own
// same-origin cookie and no Authorization header; never a credential in the URL. Plain TypeScript over a supplied `fetch` and connection, so a test shows exactly what is sent. A DPoP token is not
// accepted by the route: that connection sends nothing and says why. A reply is bytes (with
// the digest the Backend reported), a refusal in the Backend's code and words, a failed request (a GET changes nothing, so a retry is safe), or no credential at all.
import {
  DELIVERABLE_DOWNLOAD_PATH,
  DELIVERABLE_DOWNLOAD_REFUSAL_STATUS,
} from "@t3tools/aetheria-contracts";

import type { Semantics } from "./model";

/** The part of T3's prepared connection this needs: where the Backend is and what credential the connection holds. */
export interface DownloadConnection {
  readonly httpBaseUrl: string;
  readonly httpAuthorization:
    | { readonly _tag: "Bearer"; readonly token: string }
    | { readonly _tag: "Dpop"; readonly accessToken: string; readonly expiresAtEpochMs: number }
    | null;
}

export interface DownloadRequest {
  /** A `dlv_…` declaration or an `off_…` offered edit path. */
  readonly id: string;
  /** Declarations only; the current file is the default. */
  readonly semantics?: Semantics;
  /** An offered path names its root; a thread id is not a credential. */
  readonly rootThreadId?: string;
}

export type DownloadResult =
  | { readonly tag: "bytes"; readonly blob: Blob; readonly digest: string | null }
  | {
      readonly tag: "refused";
      readonly status: number;
      readonly code: string;
      readonly detail?: string;
      /** False for a code this build's contracts do not list: only the Backend's words describe it. */
      readonly known: boolean;
    }
  | { readonly tag: "no-credential"; readonly reason: string }
  | { readonly tag: "failed"; readonly reason: string };

const ID = /^(?:dlv|off)_[0-9a-f]{32}$/;

/** The route's URL. The id is checked first, so no other path can be built; the query holds a semantics and a thread id and never a credential. */
export function downloadUrl(httpBaseUrl: string, request: DownloadRequest): string {
  if (!ID.test(request.id)) throw new Error("not a declared or offered id");
  const url = new URL(`${DELIVERABLE_DOWNLOAD_PATH}/${request.id}`, httpBaseUrl);
  url.searchParams.set("semantics", request.semantics ?? "current");
  if (request.rootThreadId !== undefined) url.searchParams.set("root", request.rootThreadId);
  return url.toString();
}

const noCredential = (reason: string): DownloadResult => ({ tag: "no-credential", reason });

const isKnownCode = (code: string): boolean =>
  Object.hasOwn(DELIVERABLE_DOWNLOAD_REFUSAL_STATUS, code);

async function refusalOf(response: Response): Promise<DownloadResult> {
  let code = "";
  let detail: string | undefined;
  try {
    const body: unknown = JSON.parse(await response.text());
    if (typeof body === "object" && body !== null) {
      const fields = body as { code?: unknown; detail?: unknown };
      if (typeof fields.code === "string") code = fields.code;
      if (typeof fields.detail === "string") detail = fields.detail;
    }
  } catch {
    // A body that is not JSON (a proxy's page): the status alone is what is known.
  }
  const known = code !== "" && isKnownCode(code);
  return {
    tag: "refused",
    status: response.status,
    code: code === "" ? `HTTP_${response.status}` : code,
    ...(detail === undefined ? {} : { detail }),
    known,
  };
}

/** One authorized GET. Never sends a credential in a URL, a cookie or a redirect; never echoes the credential in a result. */
export async function fetchDeliverable(
  deps: { readonly fetch: typeof fetch; readonly connection: DownloadConnection | null },
  request: DownloadRequest,
): Promise<DownloadResult> {
  const { connection } = deps;
  if (connection === null) return noCredential("The environment is not connected.");
  const authorization = connection.httpAuthorization;
  if (authorization !== null && authorization._tag !== "Bearer") {
    return noCredential(
      "This connection uses a DPoP token, which the download route does not accept; it takes a Bearer header or the page's own signed-in session.",
    );
  }
  let url: string;
  try {
    url = downloadUrl(connection.httpBaseUrl, request);
  } catch {
    return {
      tag: "failed",
      reason: "That is not a file id the Backend offers, so no request was made.",
    };
  }
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: "GET",
      // Bearer: the header alone, no cookie. No Bearer: T3's own session, whose cookie the browser sends to the page's own origin only (T3 refuses it from another).
      ...(authorization === null
        ? { credentials: "same-origin" as const }
        : {
            headers: { authorization: `Bearer ${authorization.token}` },
            credentials: "omit" as const,
          }),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    return { tag: "failed", reason: "The request did not complete, so nothing was received." };
  }
  if (!response.ok) return refusalOf(response);
  try {
    return {
      tag: "bytes",
      blob: await response.blob(),
      digest: response.headers.get("x-aetheria-digest"),
    };
  } catch {
    return { tag: "failed", reason: "The reply began but its bytes could not be read." };
  }
}
