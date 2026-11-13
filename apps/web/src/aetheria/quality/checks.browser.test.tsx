// The matrix's own rules, shown to catch what they claim to catch (M10 Plan step 26). Each rule runs over a small page that breaks it on purpose and over one that keeps it, in a real browser with the real
// stylesheet. A rule that passed on a broken page would make a green matrix meaningless, so these run before the matrix is trusted.
import type { ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { render } from "../../../test/render";
import {
  contrastReport,
  controlReport,
  focusFindings,
  motionFindings,
  overflowFindings,
  setReducedMotion,
  sidewaysScrollers,
} from "./checks";

async function open(ui: ReactNode, width = 640) {
  await page.viewport(width, 800);
  setTheme("system");
  setAppearanceMode("light");
  refreshTheme();
  return render(<div className="min-h-svh bg-background p-4 text-foreground">{ui}</div>, {
    router: false,
  });
}

/** Reduced motion on until the test ends. */
async function reduced() {
  await setReducedMotion(true);
  return { [Symbol.asyncDispose]: () => setReducedMotion(false) };
}

describe("overflowFindings", () => {
  it("finds content wider than the viewport and passes content that fits", async () => {
    {
      await using wide = await open(
        <div style={{ width: 1400, height: 20, background: "red" }}>wide</div>,
      );
      expect(overflowFindings(640, wide.container).join("\n")).toMatch(
        /document is 1\d\d\d px wide/,
      );
    }
    await using fine = await open(<p className="break-words">fits</p>);
    expect(overflowFindings(640, fine.container)).toEqual([]);
  });
});

describe("sidewaysScrollers", () => {
  it("makes a marked frame's sideways scroll a finding and any other box's an advisory", async () => {
    const wide = <div style={{ width: 900, height: 10 }}>wide</div>;
    await using screen = await open(
      <div>
        <div data-quality-frame="sidebar" style={{ width: 200, overflowX: "auto" }}>
          {wide}
        </div>
        <pre style={{ width: 200, overflowX: "auto" }}>{"x".repeat(200)}</pre>
      </div>,
    );
    const report = sidewaysScrollers(screen.container);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toContain("scrolls sideways");
    expect(report.advisories).toHaveLength(1);
  });
});

describe("controlReport", () => {
  it("finds a control with no name and a control smaller than 24 px, and passes a named, sized one", async () => {
    await using bad = await open(
      <div>
        <button type="button" style={{ width: 40, height: 40 }} />
        <button type="button" style={{ width: 12, height: 12 }}>
          x
        </button>
      </div>,
    );
    const found = controlReport(bad.container, 640).findings;
    expect(found.some((f) => f.startsWith("no accessible name"))).toBe(true);
    expect(found.some((f) => f.includes("12x12"))).toBe(true);
    await using ok = await open(
      <button type="button" aria-label="Close" style={{ width: 30, height: 30 }} />,
    );
    expect(controlReport(ok.container, 640).findings).toEqual([]);
  });

  it("reports a phone control under 44 px as an advisory, not a failure", async () => {
    await using screen = await open(
      <button type="button" aria-label="Close" style={{ width: 30, height: 30 }} />,
      390,
    );
    const report = controlReport(screen.container, 390);
    expect(report.findings).toEqual([]);
    expect(report.advisories.join("\n")).toContain("30x30");
  });

  it("measures a small checkbox by its label, and still fails one with no label", async () => {
    {
      await using labelled = await open(
        <label className="flex min-h-9 items-center gap-2">
          <input type="checkbox" style={{ width: 16, height: 16 }} />
          Include preprints
        </label>,
      );
      expect(controlReport(labelled.container, 640).findings).toEqual([]);
    }
    await using bare = await open(
      <input type="checkbox" aria-label="Include" style={{ width: 16, height: 16 }} />,
    );
    expect(controlReport(bare.container, 640).findings.join("\n")).toContain("16x16");
  });

  it("does not hold an inline link in a sentence to the 24 px rule", async () => {
    await using screen = await open(
      <p>
        See <a href="#a">this</a> note.
      </p>,
    );
    expect(controlReport(screen.container, 640).findings).toEqual([]);
  });
});

describe("contrastReport", () => {
  it("finds light grey text on white and passes the page's own text colour", async () => {
    await using bad = await open(
      <p style={{ color: "#aaaaaa", background: "#ffffff" }}>faint words</p>,
    );
    const found = contrastReport(bad.container).findings;
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("faint words");
    await using ok = await open(<p>plain words</p>);
    expect(contrastReport(ok.container).findings).toEqual([]);
  });

  it("does not count disabled text", async () => {
    await using screen = await open(
      <button type="button" disabled style={{ color: "#aaaaaa", background: "#ffffff" }}>
        off
      </button>,
    );
    expect(contrastReport(screen.container).findings).toEqual([]);
  });
});

describe("focusFindings", () => {
  it("finds a control whose focus indicator was removed and passes the default one", async () => {
    {
      await using bad = await open(
        <div>
          <button type="button" style={{ outline: "none", boxShadow: "none" }}>
            bare
          </button>
        </div>,
      );
      expect((await focusFindings(bad.container)).join("\n")).toContain(
        "no visible focus indicator",
      );
    }
    await using ok = await open(
      <div>
        <button type="button">first</button>
        <button type="button">second</button>
      </div>,
    );
    expect(await focusFindings(ok.container)).toEqual([]);
  });

  it("finds controls that Tab never reaches", async () => {
    await using screen = await open(
      <button type="button" tabIndex={-1}>
        skipped
      </button>,
    );
    expect((await focusFindings(screen.container)).join("\n")).toContain("Tab reached none");
  });
});

describe("motionFindings", () => {
  it("passes when the preference and tokens agree and nothing runs", async () => {
    await using _reduced = await reduced();
    await using screen = await open(<p>still</p>);
    expect(motionFindings(screen.container, true)).toEqual([]);
    await setReducedMotion(false);
    expect(motionFindings(screen.container, false)).toEqual([]);
  });

  it("finds an animation still running under reduced motion, and a preference that was not applied", async () => {
    await using _reduced = await reduced();
    await using screen = await open(
      <div data-testid="moving" style={{ width: 10, height: 10, background: "red" }} />,
    );
    const moving = screen.container.querySelector<HTMLElement>("[data-testid='moving']")!;
    const animation = moving.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 5000,
      iterations: Infinity,
    });
    expect(motionFindings(screen.container, true).join("\n")).toContain("still running");
    animation.cancel();
    expect(motionFindings(screen.container, false).join("\n")).toContain("emulation");
  });
});
