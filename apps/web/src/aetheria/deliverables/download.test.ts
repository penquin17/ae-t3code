// The authorized download (M10 Plan step 16, D7/D10). Boundary: `fetchDeliverable` over a fake `fetch`: it shows what the browser sends and how it reads the Backend's reply, not the Backend's own
// route (step 14's tests) and not a separate-host download (steps 21 and 25). The credential is a Bearer header or, when the connection holds none, the page's own same-origin session cookie; never the URL.
import { describe, expect, it } from "vite-plus/test";
import {
  DELIVERABLE_DOWNLOAD_PATH,
  DELIVERABLE_DOWNLOAD_REFUSAL_STATUS,
} from "@t3tools/aetheria-contracts";

import { downloadUrl, fetchDeliverable, type DownloadConnection } from "./download";

const TOKEN = "secret-bearer-token-value";
const DLV = `dlv_${"1".repeat(32)}`;
const OFF = `off_${"2".repeat(32)}`;
const bearer: DownloadConnection = {
  httpBaseUrl: "https://backend.example:4350",
  httpAuthorization: { _tag: "Bearer", token: TOKEN },
};

interface Seen {
  url: string;
  init: RequestInit;
}
function fakeFetch(respond: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    seen.push(call);
    return respond(call);
  };
  return { fetch: fetchFn as typeof fetch, seen };
}
const bytes = (digest: string | null = null) =>
  new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: digest === null ? {} : { "x-aetheria-digest": digest },
  });

describe("downloadUrl", () => {
  it("names the route, the id and the semantics, and carries no credential", () => {
    const url = new URL(downloadUrl("https://backend.example:4350", { id: DLV }));
    expect(url.origin).toBe("https://backend.example:4350");
    expect(url.pathname).toBe(`${DELIVERABLE_DOWNLOAD_PATH}/${DLV}`);
    expect(url.searchParams.get("semantics")).toBe("current");
    expect(url.searchParams.has("root")).toBe(false);
    expect(url.username + url.password + url.hash).toBe("");
  });

  it("as-delivered and an offered path's root are named in the query", () => {
    const delivered = new URL(
      downloadUrl("https://b.example", { id: DLV, semantics: "as-delivered" }),
    );
    expect(delivered.searchParams.get("semantics")).toBe("as-delivered");
    const offered = new URL(downloadUrl("https://b.example", { id: OFF, rootThreadId: "t:1/x" }));
    expect(offered.searchParams.get("root")).toBe("t:1/x");
  });

  it("an id that is not an offered or declared id is refused before any URL is made", () => {
    expect(() => downloadUrl("https://b.example", { id: "../etc/passwd" })).toThrow();
    expect(() => downloadUrl("https://b.example", { id: `${DLV}/../x` })).toThrow();
  });
});

describe("fetchDeliverable", () => {
  it("sends the Bearer header and nothing else that carries a credential", async () => {
    const { fetch, seen } = fakeFetch(() => bytes());
    await fetchDeliverable({ fetch, connection: bearer }, { id: DLV });
    expect(seen).toHaveLength(1);
    const headers = new Headers(seen[0]!.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(seen[0]!.url).not.toContain(TOKEN);
    expect(seen[0]!.init.credentials).toBe("omit");
    expect(seen[0]!.init.redirect).toBe("error");
    expect(seen[0]!.init.cache).toBe("no-store");
    expect(seen[0]!.init.method ?? "GET").toBe("GET");
  });

  it("returns the bytes and the digest the Backend reported", async () => {
    const reported = `sha256:${"c".repeat(64)}`;
    const { fetch } = fakeFetch(() => bytes(reported));
    const result = await fetchDeliverable({ fetch, connection: bearer }, { id: DLV });
    expect(result.tag).toBe("bytes");
    if (result.tag !== "bytes") return;
    expect(result.digest).toBe(reported);
    expect(result.blob.size).toBe(3);
  });

  it("a reply without a digest header reports none, never a guess", async () => {
    const { fetch } = fakeFetch(() => bytes());
    const result = await fetchDeliverable({ fetch, connection: bearer }, { id: DLV });
    expect(result).toMatchObject({ tag: "bytes", digest: null });
  });

  it("each refusal code of the route is a refusal with the Backend's code and detail", async () => {
    for (const [code, status] of Object.entries(DELIVERABLE_DOWNLOAD_REFUSAL_STATUS)) {
      const { fetch } = fakeFetch(
        () =>
          new Response(JSON.stringify({ ok: false, code, detail: `detail of ${code}` }), {
            status,
            headers: { "content-type": "application/json" },
          }),
      );
      const result = await fetchDeliverable({ fetch, connection: bearer }, { id: DLV });
      expect(result).toEqual({
        tag: "refused",
        status,
        code,
        detail: `detail of ${code}`,
        known: true,
      });
    }
  });

  it("an unknown code or a body that is not JSON is still a refusal, flagged unknown", async () => {
    const odd = fakeFetch(
      () => new Response(JSON.stringify({ ok: false, code: "NEW_CODE" }), { status: 418 }),
    );
    expect(await fetchDeliverable({ fetch: odd.fetch, connection: bearer }, { id: DLV })).toEqual({
      tag: "refused",
      status: 418,
      code: "NEW_CODE",
      known: false,
    });
    const html = fakeFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const result = await fetchDeliverable({ fetch: html.fetch, connection: bearer }, { id: DLV });
    expect(result).toMatchObject({ tag: "refused", status: 502, known: false });
  });

  it("a request that never completes is failed, not refused, and says nothing of the credential", async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError(`network down for Bearer ${TOKEN}`);
    });
    const result = await fetchDeliverable({ fetch, connection: bearer }, { id: DLV });
    expect(result.tag).toBe("failed");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("a connection with no Bearer is T3's own signed-in session: the page's cookie goes along, same-origin only, and no Authorization header", async () => {
    const { fetch, seen } = fakeFetch(() => bytes());
    const result = await fetchDeliverable(
      { fetch, connection: { httpBaseUrl: "https://b.example", httpAuthorization: null } },
      { id: DLV },
    );
    expect(result.tag).toBe("bytes");
    expect(seen).toHaveLength(1);
    expect(new Headers(seen[0]!.init.headers).has("authorization")).toBe(false);
    expect(seen[0]!.init.credentials).toBe("same-origin");
    expect(seen[0]!.init.redirect).toBe("error");
    expect(seen[0]!.init.cache).toBe("no-store");
    // The URL never carries a credential: the cookie is the browser's, not the page's.
    expect(new URL(seen[0]!.url).search).toBe("?semantics=current");
  });

  it("a signed-in session the route refuses is a refusal in the Backend's words, not a missing credential", async () => {
    const { fetch } = fakeFetch(
      () =>
        new Response(JSON.stringify({ ok: false, code: "DOWNLOAD_UNAUTHENTICATED", detail: "x" }), {
          status: 401,
        }),
    );
    expect(
      await fetchDeliverable(
        { fetch, connection: { httpBaseUrl: "https://b.example", httpAuthorization: null } },
        { id: DLV },
      ),
    ).toMatchObject({ tag: "refused", code: "DOWNLOAD_UNAUTHENTICATED", known: true });
  });

  it("no connection or a DPoP token sends nothing and says why", async () => {
    for (const connection of [
      null,
      {
        httpBaseUrl: "https://b.example",
        httpAuthorization: { _tag: "Dpop" as const, accessToken: TOKEN, expiresAtEpochMs: 1 },
      },
    ] satisfies Array<DownloadConnection | null>) {
      const { fetch, seen } = fakeFetch(() => bytes());
      const result = await fetchDeliverable({ fetch, connection }, { id: DLV });
      expect(result.tag).toBe("no-credential");
      expect(seen).toHaveLength(0);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
  });

  it("a bad id makes no request", async () => {
    const { fetch, seen } = fakeFetch(() => bytes());
    const result = await fetchDeliverable({ fetch, connection: bearer }, { id: "nope" });
    expect(result.tag).toBe("failed");
    expect(seen).toHaveLength(0);
  });
});
