// @effect-diagnostics anyUnknownInErrorContext:off
// The deliverables page in the real app (M10 Plan step 16, D7/D9–D13, C5) on the in-process fake environment. Boundary: real router, shell, T3 atoms and the page's own RPC commands over a FAKE SOCKET
// whose client is wrapped to record every call and answer `aetheria.deliverables.*` as the test says; the download is the page's real fetcher over a SPIED `fetch` and a stubbed prepared connection
// (Bearer, or none). This is NOT the real Backend or route (step 14's tests, then step 17's native run), and not a separate-host download (steps 21 and 25). The images are for a person to view.
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type * as Context from "effect/Context";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { prepare, mountRoute } from "../harness";

const THREAD_COUNT = 40;
installFakeEnvironment([
  threadWithHistory("thread-matrix", 3),
  ...Array.from({ length: THREAD_COUNT }, (_, n) => threadWithHistory(`thread-d${n + 1}`, 1)),
]);

const TOKEN = "page-test-bearer-token";
const probe = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; input: unknown }>,
  answer: (async () => ({})) as (method: string, input: unknown) => Promise<unknown>,
  connection: null as null | {
    httpBaseUrl: string;
    httpAuthorization: null | { _tag: "Bearer"; token: string };
  },
}));

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer, Effect, Data] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
      import("effect/Effect"),
      import("effect/Data"),
    ]);
    class ProbeFailure extends Data.TaggedError("ProbeFailure")<{ readonly message: string }> {}
    const wrap = (client: Record<string, (input: unknown) => unknown>) =>
      new Proxy(client, {
        get: (target, method: string) => {
          if (method.startsWith("aetheria.")) {
            return (input: unknown) => {
              probe.calls.push({ method, input });
              return Effect.tryPromise({
                try: () => probe.answer(method, input),
                catch: (error) =>
                  new ProbeFailure({
                    message: error instanceof Error ? error.message : String(error),
                  }),
              });
            };
          }
          return target[method];
        },
      });
    const driver = {
      ...fakeDriver,
      connect: (entry: Parameters<FakeDriver["connect"]>[0]) =>
        fakeDriver.connect(entry).pipe(
          Effect.map((lease) => ({
            ...lease,
            session: { ...lease.session, client: wrap(lease.session.client as never) as never },
          })),
        ),
    };
    return {
      ...actual,
      layer: Layer.succeed(actual.ConnectionDriver, driver as unknown as FakeDriver),
    };
  },
);
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));
// The page's fetcher asks T3 for the environment's prepared connection at each request; the test says what that connection holds.
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  readPreparedConnection: () => probe.connection as never,
}));

const dlv = (n: number) => `dlv_${String(n).repeat(32)}`;
const D1 = `sha256:${"a".repeat(64)}`;
const CARD = {
  id: dlv(1),
  threadId: "thread-d1",
  turnId: "run-1",
  canonicalPath: "/work/report.md",
  title: "Quarterly report",
  kind: "markdown",
  size: 8,
  digest: D1,
  declaredAt: Date.UTC(2026, 10, 13, 9, 1),
  snapshot: { state: "attached", digest: D1, size: 8 },
  supersededBy: null,
};
const ok = (value: unknown) => ({ ok: true, value });

let counter = 0;
const nextRoot = () => `thread-d${++counter}`;
const callsTo = (method: string) => probe.calls.filter((call) => call.method === method);
const text = () => document.body.textContent ?? "";

function backend(root: string) {
  probe.calls.length = 0;
  probe.answer = async (method) => {
    if (method === "aetheria.deliverables.list") {
      return ok({ rootThreadId: root, deliverables: [{ ...CARD, threadId: root }] });
    }
    if (method === "aetheria.deliverables.offeredPaths") {
      return ok({
        rootThreadId: root,
        edits: {
          status: "known",
          paths: [{ id: `off_${"2".repeat(32)}`, canonicalPath: "/work/src/app.ts" }],
        },
      });
    }
    return { ok: false, code: "CHILDREN_UNAVAILABLE", detail: "not scripted in this test" };
  };
}

function stubFetch() {
  const seen: Array<{ url: string; headers: Headers; init: RequestInit }> = [];
  const real = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.includes("/api/aetheria/deliverables/")) return real(input, init);
    seen.push({ url, headers: new Headers(init?.headers), init: init ?? {} });
    return new Response("# report", { status: 200, headers: { "x-aetheria-digest": D1 } });
  });
  const clicks: Array<{ download: string; href: string }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (this.hasAttribute("download")) clicks.push({ download: this.download, href: this.href });
  });
  return { seen, clicks, [Symbol.dispose]: () => vi.restoreAllMocks() };
}

async function open(width: number, height: number, mode: "light" | "dark", root: string) {
  await prepare(width, height, mode);
  backend(root);
  return mountRoute(`/aetheria/deliverables/${ENVIRONMENT_ID}/${root}`);
}

describe("the deliverables route", () => {
  it("a deep link renders the page and reads the root's cards and edited files over the Aetheria group", async () => {
    probe.connection = null;
    const root = nextRoot();
    const app = await open(1280, 800, "light", root);
    await using _screen = app.screen;
    await expect.poll(() => text(), { timeout: 15_000 }).toContain("Quarterly report");
    expect(document.querySelector("h1")?.textContent).toBe("Deliverables");
    expect(callsTo("aetheria.deliverables.list")[0]?.input).toEqual({ rootThreadId: root });
    expect(callsTo("aetheria.deliverables.offeredPaths")[0]?.input).toEqual({ rootThreadId: root });
    await expect.poll(() => text()).toContain("/work/src/app.ts");
    expect(text()).toContain("Edited files: per session, not per turn; shell writes not tracked.");
    expect(text()).toContain("Terminal page not mounted");
    expect(app.router.state.location.pathname).toBe(
      `/aetheria/deliverables/${ENVIRONMENT_ID}/${root}`,
    );
  });

  it("a download sends the environment's Bearer header, no credential in the URL, and saves under the file's name", async () => {
    probe.connection = {
      httpBaseUrl: "https://backend.test:4350",
      httpAuthorization: { _tag: "Bearer", token: TOKEN },
    };
    using stub = stubFetch();
    const { seen, clicks } = stub;
    const root = nextRoot();
    const app = await open(1280, 800, "light", root);
    await using screen = app.screen;
    await expect.poll(() => text(), { timeout: 15_000 }).toContain("Quarterly report");
    await screen.getByRole("button", { name: "Download current file of Quarterly report" }).click();
    await expect.poll(() => clicks.length).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(
      `https://backend.test:4350/api/aetheria/deliverables/${dlv(1)}?semantics=current`,
    );
    expect(seen[0]!.url).not.toContain(TOKEN);
    expect(seen[0]!.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(seen[0]!.init.credentials).toBe("omit");
    expect(clicks[0]!.download).toBe("report.md");
    expect(clicks[0]!.href).toMatch(/^blob:/);
    await expect.poll(() => text()).toContain("matches the digest declared");
    expect(text()).not.toContain(TOKEN);
  });

  it("a connection with no Bearer is T3's signed-in session: the download sends the page's same-origin cookie and no Authorization header", async () => {
    probe.connection = { httpBaseUrl: "http://localhost:3080", httpAuthorization: null };
    using stub = stubFetch();
    const { seen, clicks } = stub;
    const root = nextRoot();
    const app = await open(1280, 800, "light", root);
    await using screen = app.screen;
    await expect.poll(() => text(), { timeout: 15_000 }).toContain("Quarterly report");
    await screen.getByRole("button", { name: "Download current file of Quarterly report" }).click();
    await expect.poll(() => clicks.length).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers.has("authorization")).toBe(false);
    expect(seen[0]!.init.credentials).toBe("same-origin");
    expect(seen[0]!.url).toBe(
      `http://localhost:3080/api/aetheria/deliverables/${dlv(1)}?semantics=current`,
    );
    expect(clicks[0]!.download).toBe("report.md");
    expect(text()).not.toContain("holds no Bearer credential");
  });

  it("a Backend that answers nothing for the list leaves it unknown, not empty", async () => {
    probe.connection = null;
    const root = nextRoot();
    await prepare(1280, 800, "light");
    backend(root);
    probe.answer = async () => ({
      ok: false,
      code: "DELIVERABLES_UNAVAILABLE",
      detail: "stopping",
    });
    const app = await mountRoute(`/aetheria/deliverables/${ENVIRONMENT_ID}/${root}`);
    await using _screen = app.screen;
    await expect.poll(() => text(), { timeout: 15_000 }).toContain("stopping");
    expect(text()).toContain("The deliverables are unavailable");
    expect(text()).not.toContain("lists no delivered files");
  });

  it.each(
    [1280, 390].flatMap((width) =>
      (["light", "dark"] as const).map((mode) => [width, mode] as const),
    ),
  )(
    "the page at %i wide, %s: the chrome stays, nothing overflows sideways",
    async (width, mode) => {
      probe.connection = null;
      const root = nextRoot();
      const app = await open(width, width === 1280 ? 800 : 844, mode, root);
      await using _screen = app.screen;
      await expect.poll(() => text(), { timeout: 15_000 }).toContain("Quarterly report");
      await expect.poll(() => text()).toContain("/work/src/app.ts");
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      expect(document.querySelector("[data-aetheria='deliverables-page']")).not.toBe(null);
      await page.screenshot({
        base64: true,
        path: `__screenshots__/deliverables-page-${width}-${mode}.png`,
        save: true,
      });
    },
  );
});
