// The status as it appears in the shell (M10 step 20, Phase B): nothing when connected, the banner with its offers otherwise, at a sidebar's width and a page's, in both modes.
// Boundary: `ConnectionStatusView` over views the model derived from facts that the controller produced, in a real browser with the real stylesheet. It does not mount the hook against T3's atoms
// (the shell mount belongs to the sidebar and page owners; the hook's decisions are the controller's unit tests, and its atoms are type-checked only) and no Backend answers. Images are evidence for a person.
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { render } from "../../../test/render";
import { createConnectionController, type ConnectionInputs } from "./controller";
import { ConnectionStatusView } from "./ConnectionStatus";
import { viewOf, type ConnectionFacts, type ConnectionView } from "./state";

type Mode = "light" | "dark";
const MODES: readonly Mode[] = ["light", "dark"];
const EXPECTED = `sha256:${"a1".repeat(32)}`;
const ACTUAL = `sha256:${"b2".repeat(32)}`;

const supervisor = (
  patch: Partial<ConnectionInputs["supervisor"]>,
): ConnectionInputs["supervisor"] => ({
  desired: true,
  network: "online",
  phase: "connecting",
  stage: "opening",
  attempt: 1,
  generation: 1,
  lastFailure: null,
  retryAt: null,
  ...patch,
});
const live = { status: "live", hasSnapshot: true, generation: 4 } as const;

/** The view the controller reaches from what T3 reports, with the probe and status read answering as given. */
async function viewAfter(
  steps: readonly ConnectionInputs[],
  answers: {
    probe?: Parameters<typeof createConnectionController>[0]["probe"];
    status?: Parameters<typeof createConnectionController>[0]["readComposition"];
  } = {},
): Promise<ConnectionView> {
  let facts: ConnectionFacts | null = null;
  const controller = createConnectionController({
    expected: { tag: "present", value: EXPECTED },
    probe: answers.probe ?? (async () => ({ tag: "inconclusive", reason: "none" })),
    readComposition:
      answers.status ??
      (async () => ({ tag: "read", digest: EXPECTED, phase: "running", modules: [] })),
    onFacts: (next) => {
      facts = next;
    },
  });
  // Each report is followed by a tick, so a read it started has answered before T3 reports the next change.
  for (const step of steps) {
    controller.observe(step);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  }
  return viewOf(facts!);
}

const connectedInputs: ConnectionInputs = {
  supervisor: supervisor({ phase: "connected" }),
  sessions: 1,
  shell: live,
};
const SERVER_WORDS =
  "This Backend was built from a different composition than this client expects.";

async function views() {
  return {
    connected: await viewAfter([connectedInputs]),
    reconnecting: await viewAfter([
      connectedInputs,
      {
        supervisor: supervisor({ phase: "backoff", attempt: 2, retryAt: 9 }),
        sessions: 1,
        shell: { ...live, status: "cached" },
      },
    ]),
    mismatch: await viewAfter(
      [
        {
          supervisor: supervisor({ phase: "backoff", attempt: 1 }),
          sessions: 0,
          shell: { status: "empty", hasSnapshot: false, generation: 0 },
        },
      ],
      {
        probe: async () => ({
          tag: "refused",
          refusal: {
            status: 409,
            code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
            message: SERVER_WORDS,
            expectedDigest: EXPECTED,
            actualDigest: ACTUAL,
          },
        }),
      },
    ),
    unreadStatus: await viewAfter([connectedInputs], {
      status: async () => ({ tag: "unavailable", reason: "no Backend answered the status read" }),
    }),
  };
}

async function setup(width: number, height: number, mode: Mode) {
  await page.viewport(width, height);
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
}

describe("ConnectionStatusView", () => {
  it("draws nothing when connected, and a banner for every other state the controller reaches", async () => {
    await setup(1280, 900, "light");
    const v = await views();
    await using screen = await render(
      <div data-testid="shell">
        <ConnectionStatusView view={v.connected} />
        <ConnectionStatusView view={v.reconnecting} />
      </div>,
      { router: false },
    );
    const kinds = [...screen.container.querySelectorAll("[data-connection-kind]")].map(
      (el) => (el as HTMLElement).dataset.connectionKind,
    );
    expect(kinds).toEqual(["reconnecting"]);
    expect(screen.container.querySelector("[data-connection-kind='reconnecting']")).toHaveAttribute(
      "data-connection-stale",
      "true",
    );
  });

  it("offers reload and sign-in only where the state has them, and calls the supplied handler", async () => {
    await setup(1280, 900, "light");
    const v = await views();
    const onReload = vi.fn();
    const onSignIn = vi.fn();
    await using screen = await render(
      <div>
        <ConnectionStatusView view={v.mismatch} onReload={onReload} onSignIn={onSignIn} />
        <ConnectionStatusView view={v.reconnecting} onReload={onReload} onSignIn={onSignIn} />
      </div>,
      { router: false },
    );
    const buttons = [...screen.container.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Reload"]);
    buttons[0]!.click();
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("shows the refusal the probe read, with the server's words verbatim and both digests, and the status-less modules as unavailable", async () => {
    await setup(1280, 900, "light");
    const v = await views();
    await using screen = await render(<ConnectionStatusView view={v.mismatch} />, {
      router: false,
    });
    const banner = screen.container.querySelector<HTMLElement>(
      "[data-connection-kind='version-mismatch']",
    )!;
    expect(banner.dataset.connectionCause).toBe("digest-mismatch");
    expect(banner.querySelector("[data-verbatim='server']")?.textContent).toBe(SERVER_WORDS);
    expect(banner.querySelector("[data-digest='expected']")?.textContent).toBe(EXPECTED);
    expect(banner.querySelector("[data-digest='actual']")?.textContent).toBe(ACTUAL);
    expect(banner.querySelector("[data-testid='connection-modules']")).toBeNull();
  });

  const WIDTHS = [
    ["sidebar", 288, 700],
    ["page", 672, 900],
  ] as const;
  it.each(
    WIDTHS.flatMap(([name, width, height]) =>
      MODES.map((mode) => [name, width, height, mode] as const),
    ),
  )("%s width %i, %s: the banners fit and are captured", async (name, width, height, mode) => {
    await setup(width + 32, height, mode);
    const v = await views();
    await using screen = await render(
      <div data-testid="column" className="flex flex-col gap-2 p-4" style={{ width }}>
        <ConnectionStatusView view={v.reconnecting} />
        <ConnectionStatusView view={v.mismatch} />
        <ConnectionStatusView view={v.unreadStatus} />
      </div>,
      { router: false },
    );
    const column = screen.container.querySelector<HTMLElement>("[data-testid='column']")!;
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    for (const el of column.querySelectorAll<HTMLElement>("[data-connection-kind]")) {
      expect(el.scrollWidth, el.dataset.connectionKind).toBeLessThanOrEqual(el.clientWidth + 1);
    }
    await page.screenshot({
      base64: true,
      path: `__screenshots__/connection-status-${name}-${width}-${mode}.png`,
      save: true,
    });
  });
});
