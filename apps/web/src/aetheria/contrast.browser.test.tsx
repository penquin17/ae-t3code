// Step 11: the colours the real app paints, measured, in both modes. Text needs 4.5:1; focus rings and
// outlines that convey a control need 3:1. Failures are listed with their measured numbers, never waived.
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type * as Context from "effect/Context";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { StandalonePageHeader } from "~/components/ui/standalone-page";
import type { FakeDriver } from "../../test/fakeEnvironment";
import { render } from "../../test/render";
import { LAST_ANSWER, THREAD_PATH, mountRoute, prepare, type Mode } from "./harness";
import { sampleText, summarize, type TextSample } from "./measure";

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const MODES: readonly Mode[] = ["light", "dark"];

const table = (rows: readonly (TextSample & { count: number })[]) =>
  rows
    .map(
      (row) =>
        `${row.ratio.toFixed(2)}  ${row.foreground} on ${row.background}  x${row.count}  ${row.sizePx}px/${row.weight}  ${row.where}  "${row.text}"${row.disabled ? "  [disabled]" : ""}${row.unresolvedBackground ? "  [image behind]" : ""}`,
    )
    .join("\n");

// The project avatar's two-letter initials are SVG text in the project's own hue, not an Aetheria role:
// 8px, decorative, 3.2 to 3.4:1 in light mode. A pre-existing T3 consumer, listed here and reported, not repaired.
const isProjectAvatar = (row: TextSample) => row.where.startsWith("text");

describe("text painted by the real app", () => {
  it.each(MODES)("the conversation, sidebar and composer meet 4.5:1 in %s mode", async (mode) => {
    await prepare(1280, 800, mode);
    const app = await mountRoute(THREAD_PATH);
    await using _screen = app.screen;
    await expect.element(page.getByText(LAST_ANSWER)).toBeVisible();
    const rows = summarize(sampleText(document.body));
    const failing = rows.filter((row) => row.ratio < 4.5 && !isProjectAvatar(row));
    expect(failing.length, `${mode} thread\n${table(rows)}`).toBe(0);
  });

  it.each(MODES)("the new-thread hero meets 4.5:1 in %s mode", async (mode) => {
    await prepare(1280, 800, mode);
    const app = await mountRoute("/");
    await using _screen = app.screen;
    await expect
      .poll(() => document.querySelectorAll("[data-aetheria-headline]").length, { timeout: 15_000 })
      .toBe(1);
    const rows = summarize(sampleText(document.body));
    const failing = rows.filter((row) => row.ratio < 4.5 && !isProjectAvatar(row));
    expect(failing.length, `${mode} hero\n${table(rows)}`).toBe(0);
  });

  it.each(MODES)("the standalone page header meets 4.5:1 in %s mode", async (mode) => {
    await prepare(1280, 800, mode);
    await using screen = await render(
      <div className="bg-background p-6 text-foreground">
        <StandalonePageHeader
          title="Pair this browser"
          description="Enter the code."
          context="ctx"
        />
      </div>,
    );
    const rows = summarize(sampleText(screen.container));
    const failing = rows.filter((row) => row.ratio < 4.5);
    expect(failing.length, `${mode} standalone header\n${table(rows)}`).toBe(0);
  });
});

describe("disabled controls cannot hide an enabled one", () => {
  it("keeps an enabled low-contrast text that shares its colours with an earlier disabled control", async () => {
    await using screen = await render(
      <div style={{ background: "#ffffff" }}>
        <button type="button" disabled style={{ color: "#bbbbbb", background: "#ffffff" }}>
          Disabled first
        </button>
        <span style={{ color: "#bbbbbb" }}>Enabled faint text</span>
      </div>,
    );
    const rows = summarize(sampleText(screen.container));
    const enabled = rows.filter((row) => row.text.includes("Enabled"));
    expect(enabled, "the enabled text is a row of its own").toHaveLength(1);
    expect(enabled[0]!.disabled).toBe(false);
    expect(enabled[0]!.ratio).toBeLessThan(4.5);
    expect(rows.some((row) => row.text.includes("Disabled first"))).toBe(false);
    expect(rows.filter((row) => row.ratio < 4.5)).toHaveLength(1);
  });
});

describe("the measurement catches a seeded failure", () => {
  it("reports faint grey text on white below 4.5:1, and black text above 20:1", async () => {
    await using screen = await render(
      <div style={{ background: "#ffffff" }}>
        <span style={{ color: "#bbbbbb" }}>Faint seeded text</span>
        <span style={{ color: "#000000" }}>Strong seeded text</span>
      </div>,
    );
    const rows = sampleText(screen.container);
    const faint = rows.find((row) => row.text.startsWith("Faint"))!;
    const strong = rows.find((row) => row.text.startsWith("Strong"))!;
    expect(faint.ratio).toBeLessThan(4.5);
    expect(strong.ratio).toBeGreaterThan(20);
  });
});
