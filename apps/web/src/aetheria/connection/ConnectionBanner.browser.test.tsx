// The connection banner as drawn in a real browser with the real stylesheet: every state the model can be in, the server's words verbatim beside this client's own, digests, and the module list only when the composition status supplied it.
// Boundary: one component over views the model derived from facts; no socket and no Backend. The images are evidence for a person to view; the assertions prove words, verbatim text, absence of invented content and layout.
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { applyBaseline, awaitingBaseline } from "../core/resync";
import { render } from "../../../test/render";
import { ConnectionBanner } from "./ConnectionBanner";
import {
  applyEvent,
  initialFacts,
  viewOf,
  type ConnectionEvent,
  type ConnectionFacts,
  type ConnectionView,
  type Locale,
  type TransportFacts,
} from "./state";

type Mode = "light" | "dark";
const MODES: readonly Mode[] = ["light", "dark"];
const SIZES = [
  [1280, 1500],
  [390, 3600],
] as const;

const EXPECTED = `sha256:${"a1".repeat(32)}`;
const ACTUAL = `sha256:${"b2".repeat(32)}`;
const SERVER_WORDS =
  "This server's Aetheria Backend was built from a different composition than this client expects.";
const T3_WORDS = "Update this client to one that supports orchestration protocol 2.";
const SIGN_IN_WORDS = "The pairing credential for this device was rejected by the host.";

const open: TransportFacts = {
  network: "online",
  phase: "connected",
  stage: null,
  attempt: 1,
  retryAt: null,
  blocked: null,
};
const live = applyBaseline(awaitingBaseline<number>(), 1, 1);
const modules = [
  { id: "agent-awareness-backend", required: true, state: "running" },
  { id: "providers-backend", required: true, state: "running" },
  { id: "interaction-backend", required: false, state: "failed" },
];
const healthy = (generation: number, digest = EXPECTED): ConnectionEvent[] => [
  { type: "transport", generation, transport: open },
  { type: "ready", generation },
  { type: "projection", generation, projection: live },
  { type: "composition", generation, result: { tag: "read", digest, phase: "running", modules } },
];
const fold = (
  events: readonly ConnectionEvent[],
  facts: ConnectionFacts = initialFacts({ tag: "present", value: EXPECTED }),
) => events.reduce(applyEvent, facts);

function states(locale: Locale): ReadonlyArray<readonly [string, ConnectionView]> {
  const v = (facts: ConnectionFacts) => viewOf(facts, locale);
  const connected = fold(healthy(1));
  return [
    ["connected", v(connected)],
    [
      "connecting",
      v(
        fold([
          { type: "transport", generation: 1, transport: open },
          { type: "ready", generation: 1 },
        ]),
      ),
    ],
    [
      "reconnecting",
      v(
        applyEvent(connected, {
          type: "transport",
          generation: 1,
          transport: { ...open, phase: "backoff", attempt: 3, retryAt: 9000 },
        }),
      ),
    ],
    [
      "offline",
      v(
        applyEvent(connected, {
          type: "transport",
          generation: 1,
          transport: { ...open, phase: "offline", network: "offline" },
        }),
      ),
    ],
    [
      "unauthorized",
      v(
        fold([
          {
            type: "transport",
            generation: 1,
            transport: {
              ...open,
              phase: "blocked",
              blocked: { reason: "authentication", detail: SIGN_IN_WORDS },
            },
          },
        ]),
      ),
    ],
    [
      "access-ended",
      v(
        applyEvent(connected, { type: "call-refused", generation: 1, code: "JOBS_DEVICE_REVOKED" }),
      ),
    ],
    [
      "digest-mismatch",
      v(
        fold([
          {
            type: "upgrade-refused",
            generation: 1,
            refusal: {
              status: 409,
              code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
              message: SERVER_WORDS,
              actualDigest: ACTUAL,
              expectedDigest: EXPECTED,
            },
          },
        ]),
      ),
    ],
    [
      "protocol",
      v(
        fold([
          {
            type: "upgrade-refused",
            generation: 1,
            refusal: {
              status: 426,
              code: "orchestration_protocol_incompatible",
              message: T3_WORDS,
            },
          },
        ]),
      ),
    ],
    ["digest-differs", v(fold(healthy(1, ACTUAL)))],
    ["client-digest-absent", v(fold(healthy(1), initialFacts({ tag: "absent" })))],
    ["unknown", v(fold([{ type: "upgrade-refused", generation: 1, refusal: { status: 502 } }]))],
  ];
}

function Sheet({
  locale,
  onReload,
  onSignIn,
}: {
  readonly locale: Locale;
  readonly onReload?: () => void;
  readonly onSignIn?: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4" data-testid="sheet">
      {states(locale).map(([name, view]) => (
        <ConnectionBanner
          key={name}
          view={view}
          locale={locale}
          {...(onReload ? { onReload } : {})}
          {...(onSignIn ? { onSignIn } : {})}
        />
      ))}
    </main>
  );
}

async function setup(width: number, height: number, mode: Mode) {
  await page.viewport(width, height);
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
}

const banner = (root: HTMLElement, kind: string, cause?: string) =>
  [...root.querySelectorAll<HTMLElement>(`[data-connection-kind='${kind}']`)].find(
    (el) => cause === undefined || el.dataset.connectionCause === cause,
  )!;

describe("ConnectionBanner", () => {
  it.each(MODES)(
    "shows the server's and T3's words verbatim, with whose they are, and invents no module, %s",
    async (mode) => {
      await setup(1280, 1500, mode);
      await using screen = await render(<Sheet locale="en" />, { router: false });
      const root = screen.container;
      const mismatch = banner(root, "version-mismatch", "digest-mismatch");
      expect(mismatch.querySelector("[data-verbatim='server']")?.textContent).toBe(SERVER_WORDS);
      expect(mismatch.textContent).toContain("Server says");
      expect(mismatch.querySelector("[data-digest='expected']")?.textContent).toBe(EXPECTED);
      expect(mismatch.querySelector("[data-digest='actual']")?.textContent).toBe(ACTUAL);
      expect(mismatch.textContent).toContain("AETHERIA_BACKEND_DIGEST_MISMATCH");
      // The refusal carried no module list, so none is drawn and no module is named.
      expect(mismatch.querySelector("[data-testid='connection-modules']")).toBeNull();
      expect(mismatch.querySelectorAll("[data-module]")).toHaveLength(0);

      const protocol = banner(root, "version-mismatch", "protocol");
      expect(protocol.querySelector("[data-verbatim='server']")?.textContent).toBe(T3_WORDS);

      const unauthorized = banner(root, "unauthorized");
      expect(unauthorized.querySelector("[data-verbatim='t3']")?.textContent).toBe(SIGN_IN_WORDS);
      expect(unauthorized.textContent).toContain("T3 says");
      // 401 is not claimed to be a revocation.
      expect(unauthorized.textContent).not.toMatch(/revoked/i);
    },
  );

  it("draws the module list only where the composition status supplied it", async () => {
    await setup(1280, 1500, "light");
    await using screen = await render(<Sheet locale="en" />, { router: false });
    const withModules = [...screen.container.querySelectorAll("[data-connection-kind]")].filter(
      (el) => el.querySelector("[data-testid='connection-modules']") !== null,
    ) as HTMLElement[];
    expect(
      withModules.map((el) => `${el.dataset.connectionKind}/${el.dataset.connectionCause}`).sort(),
    ).toEqual([
      "connected/",
      // This sheet's client-digest-absent state was folded from a generation whose status WAS read, so its list is the Backend's reading, shown as such.
      "version-mismatch/client-digest-absent",
      "version-mismatch/digest-differs",
    ]);
    const differs = banner(screen.container, "version-mismatch", "digest-differs");
    expect([...differs.querySelectorAll("[data-module]")].map((li) => li.textContent)).toEqual([
      "agent-awareness-backend: running (required)",
      "providers-backend: running (required)",
      "interaction-backend: failed",
    ]);
  });

  it("announces blocking states as alerts and passing ones as status, and blocks actions everywhere but connected", async () => {
    await setup(1280, 1500, "light");
    await using screen = await render(<Sheet locale="en" />, { router: false });
    const all = [...screen.container.querySelectorAll<HTMLElement>("[data-connection-kind]")];
    for (const el of all) {
      const kind = el.dataset.connectionKind!;
      expect(el.dataset.connectionActions, kind).toBe(kind === "connected" ? "allowed" : "blocked");
      const alert = ["unauthorized", "access-ended", "version-mismatch", "unknown"].includes(kind);
      expect(el.getAttribute("role"), kind).toBe(alert ? "alert" : "status");
    }
    expect(banner(screen.container, "reconnecting").dataset.connectionStale).toBe("true");
    expect(banner(screen.container, "connected").dataset.connectionStale).toBe("false");
    expect(
      banner(screen.container, "reconnecting").querySelector("[data-testid='connection-attempt']")
        ?.textContent,
    ).toBe("Attempt 3");
  });

  it("offers reload and sign-in only when the intent is supplied, and calls it once on press", async () => {
    await setup(1280, 1500, "light");
    const none = await render(<Sheet locale="en" />, { router: false });
    expect(none.container.querySelectorAll("button")).toHaveLength(0);
    await none[Symbol.asyncDispose]();

    const onReload = vi.fn();
    const onSignIn = vi.fn();
    await using screen = await render(
      <Sheet locale="en" onReload={onReload} onSignIn={onSignIn} />,
      { router: false },
    );
    const buttons = [...screen.container.querySelectorAll<HTMLButtonElement>("button")];
    const reload = buttons.filter((b) => b.textContent === "Reload");
    const signIn = buttons.filter((b) => b.textContent === "Sign in again");
    // reload: version-mismatch ×4 (digest-mismatch, protocol, digest-differs, client-digest-absent) + unknown; sign-in: unauthorized + access-ended.
    expect(reload).toHaveLength(5);
    expect(signIn).toHaveLength(2);
    reload[0]!.click();
    signIn[0]!.click();
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onSignIn).toHaveBeenCalledTimes(1);
    for (const el of screen.container.querySelectorAll<HTMLElement>(
      "[data-connection-kind='connected'], [data-connection-kind='connecting']",
    )) {
      expect(el.querySelector("button")).toBeNull();
    }
  });

  it("shows the Chinese headline and labels while the server's words stay in their own language", async () => {
    await setup(1280, 1500, "light");
    await using screen = await render(<Sheet locale="zh" />, { router: false });
    const mismatch = banner(screen.container, "version-mismatch", "digest-mismatch");
    expect(mismatch.getAttribute("lang")).toBe("zh");
    expect(mismatch.textContent).toMatch(/[\u4e00-\u9fff]/);
    expect(mismatch.querySelector("[data-verbatim='server']")?.textContent).toBe(SERVER_WORDS);
    expect(mismatch.querySelector("[data-verbatim='server']")?.getAttribute("lang")).toBe("en");
  });

  const CASES = SIZES.flatMap(([width, height]) =>
    MODES.flatMap((mode) =>
      (["en", "zh"] as const).map((lang) => [width, height, mode, lang] as const),
    ),
  );
  it.each(CASES)(
    "%i wide (%i high), %s, %s: nothing overflows sideways",
    async (width, height, mode, lang) => {
      await setup(width, height, mode);
      await using screen = await render(
        <Sheet locale={lang} onReload={() => undefined} onSignIn={() => undefined} />,
        { router: false },
      );
      const sheet = screen.container.querySelector<HTMLElement>("[data-testid='sheet']")!;
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      for (const el of sheet.querySelectorAll<HTMLElement>("[data-connection-kind]")) {
        expect(el.scrollWidth, el.dataset.connectionKind).toBeLessThanOrEqual(el.clientWidth + 1);
      }
      await page.screenshot({
        base64: true,
        path: `__screenshots__/connection-banner-${width}-${mode}-${lang}.png`,
        save: true,
      });
    },
  );
});
