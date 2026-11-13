// The refusal notice as drawn in a real browser with the real stylesheet: a display line, the Backend's message and the coverage sentence verbatim, an unknown code that is never hidden, both languages.
// Boundary: one component over supplied values; no backend. The images are evidence for a person to view; the assertions prove the words, the verbatim text and the layout.
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { render } from "../../../test/render";
import { RefusalNotice } from "./RefusalNotice";

type Mode = "light" | "dark";
const MODES: readonly Mode[] = ["light", "dark"];
const SIZES = [
  [1280, 800],
  [390, 844],
] as const;

const LONG_MESSAGE =
  "The file /Users/someone/projects/a-very-long-project-name/src/components/deeply/nested/folder/with/a/long/path/ReallyLongComponentName.tsx changed since this session read it; read it again before writing. " +
  "A second sentence so the message wraps over several lines at a phone width.";
const COVERAGE =
  "Enforced at: the guarded write tools. Fails: closed. Covers: the file's version this session read. Does not cover: a write made outside these tools.";

function Sheet({ lang }: { readonly lang: "en" | "zh" }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4" data-testid="sheet">
      <RefusalNotice
        code="T1_STALE"
        backendMessage={LONG_MESSAGE}
        coverage={COVERAGE}
        locale={lang}
      />
      <RefusalNotice
        code="INTERACTION_UNAVAILABLE"
        backendMessage="the interaction service failed"
        locale={lang}
      />
      <RefusalNotice code="COORDINATION_UNAVAILABLE" locale={lang} />
      <RefusalNotice
        code="SOMETHING_NEW"
        backendMessage="A refusal this build has no line for."
        locale={lang}
      />
    </main>
  );
}

async function setup(width: number, height: number, mode: Mode) {
  await page.viewport(width, height);
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
}

describe("RefusalNotice", () => {
  it.each(MODES)("shows the display line and the Backend's text verbatim, %s", async (mode) => {
    await setup(1280, 800, mode);
    await using screen = await render(<Sheet lang="en" />, { router: false });
    const notices = [...screen.container.querySelectorAll<HTMLElement>("[data-refusal-code]")];
    expect(notices.map((n) => n.dataset.refusalCode)).toEqual([
      "T1_STALE",
      "INTERACTION_UNAVAILABLE",
      "COORDINATION_UNAVAILABLE",
      "SOMETHING_NEW",
    ]);
    const first = notices[0]!;
    // The Backend's message and the coverage sentence are present unchanged, character for character.
    expect(first.querySelector("[data-verbatim='backend']")?.textContent).toBe(LONG_MESSAGE);
    expect(first.querySelector("[data-verbatim='coverage']")?.textContent).toBe(COVERAGE);
    // The code is shown so a person can quote it.
    expect(first.textContent).toContain("T1_STALE");
    // An unknown code still shows its text, once, and says it is not a known code.
    const unknown = notices[3]!;
    expect(unknown.textContent).toContain("A refusal this build has no line for.");
    expect(unknown.querySelectorAll("[data-verbatim='backend']")).toHaveLength(0);
    expect(unknown.dataset.refusalKnown).toBe("false");
    expect(unknown.textContent).toContain("SOMETHING_NEW");
    // The code-less warning is worded as applied with a warning, in a status region rather than an alert.
    expect(notices[2]!.textContent).toMatch(/applied/i);
    expect(notices[2]!.getAttribute("role")).toBe("status");
    expect(notices[1]!.getAttribute("role")).toBe("alert");
  });

  it("shows the Chinese line for a known code and leaves the Backend's text in its own language", async () => {
    await setup(1280, 800, "light");
    await using screen = await render(<Sheet lang="zh" />, { router: false });
    const first = screen.container.querySelector<HTMLElement>("[data-refusal-code='T1_STALE']")!;
    expect(first.textContent).toMatch(/[\u4e00-\u9fff]/);
    expect(first.querySelector("[data-verbatim='backend']")?.textContent).toBe(LONG_MESSAGE);
    expect(first.getAttribute("lang")).toBe("zh");
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
      await using screen = await render(<Sheet lang={lang} />, { router: false });
      const sheet = screen.container.querySelector<HTMLElement>("[data-testid='sheet']")!;
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      for (const notice of sheet.querySelectorAll<HTMLElement>("[data-refusal-code]")) {
        expect(notice.scrollWidth).toBeLessThanOrEqual(notice.clientWidth + 1);
      }
      await page.screenshot({
        base64: true,
        path: `__screenshots__/refusals-notice-${width}-${mode}-${lang}.png`,
        save: true,
      });
    },
  );
});
