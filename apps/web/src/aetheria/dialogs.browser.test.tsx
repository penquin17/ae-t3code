// F1: the two dialogs whose copy Aetheria changed, rendered and exercised: the welcome wizard (opened the way
// T3 opens it, through the /welcome route of the real app) and the update dialog (a controlled component,
// opened from a trigger with fixture state). Contrast, names, keyboard, identity strings and actions.
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import type * as Context from "effect/Context";
import { EnvironmentId } from "@t3tools/contracts";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { UpdateEverythingDialog } from "~/components/sidebar/UpdateEverythingDialog";
import type { UpdateEverythingRow } from "~/components/sidebar/updateEverything.logic";
import { ENVIRONMENT_ID, type FakeDriver } from "../../test/fakeEnvironment";
import { render } from "../../test/render";
import { accessibleName, interactiveIn, mountRoute, prepare, type Mode } from "./harness";
import {
  over,
  ratio,
  resolveColor,
  sampleText,
  summarize,
  surfaceBehind,
  type TextSample,
} from "./measure";

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
const dialog = () => document.querySelector<HTMLElement>("[role='dialog'], [role='alertdialog']");
const table = (rows: readonly (TextSample & { count: number })[]) =>
  rows
    .map(
      (row) =>
        `${row.ratio.toFixed(2)}  ${row.foreground} on ${row.background}  x${row.count}  ${row.sizePx}px  ${row.where}  "${row.text}"${row.disabled ? "  [disabled]" : ""}`,
    )
    .join("\n");

/** The dialog has stopped animating in: nothing running and every ancestor fully opaque, so what is measured is what is seen. */
async function dialogSettled() {
  await expect
    .poll(
      () => {
        const element = dialog();
        if (!element) return "no dialog";
        const running = document
          .getAnimations()
          .filter((animation) => animation.playState === "running").length;
        let opacity = 1;
        for (let node: Element | null = element; node; node = node.parentElement) {
          opacity *= Number.parseFloat(getComputedStyle(node).opacity);
        }
        return running === 0 && opacity === 1 ? "settled" : `running=${running} opacity=${opacity}`;
      },
      { timeout: 8000 },
    )
    .toBe("settled");
}

/** Presses Tab up to `limit` times and returns every element that took focus, in order. */
async function tabOrder(limit: number): Promise<Element[]> {
  const seen: Element[] = [];
  // Let the dialog finish moving focus into itself before the first press.
  await expect
    .poll(() => dialog()?.contains(document.activeElement) ?? false, { timeout: 5000 })
    .toBe(true);
  for (let press = 0; press < limit; press++) {
    await userEvent.keyboard("{Tab}");
    // The trap may hand focus over through a sentinel for a moment; focus that stays outside is an escape.
    await expect
      .poll(() => dialog()?.contains(document.activeElement) ?? false, { timeout: 2000 })
      .toBe(true)
      .catch(() => undefined);
    const active = document.activeElement;
    if (active && seen.at(-1) !== active) seen.push(active);
  }
  return seen;
}

describe("the welcome wizard, opened through the real /welcome route", () => {
  async function openWizard(mode: Mode) {
    await prepare(1280, 800, mode);
    const app = await mountRoute("/welcome");
    await expect.poll(() => dialog() !== null, { timeout: 15_000 }).toBe(true);
    // Scoped to the dialog, not the page: a mount left behind by a timed-out test must not make this ambiguous.
    await expect
      .poll(() => dialog()?.innerText.includes("Connect your computers") ?? false, {
        timeout: 10_000,
      })
      .toBe(true);
    await dialogSettled();
    return app;
  }

  it.each(MODES)(
    "shows Aetheria's identity and keeps T3's instructional text, %s mode",
    async (mode) => {
      const app = await openWizard(mode);
      await using _screen = app.screen;
      const text = dialog()!.innerText;
      expect(text).toContain("Set up Aetheria");
      expect(text).toContain("T3 Code collects anonymous usage data");
      expect(text).not.toContain("Set up T3 Code");
      expect(dialog()!.querySelector("img[src*='aetheria-mark']")).not.toBeNull();
      expect(
        accessibleName(dialog()!.querySelector("h1, h2, [data-slot='dialog-title']") ?? dialog()!),
      ).toContain("Set up Aetheria");
    },
  );

  it.each(MODES)("paints every enabled text pair at 4.5:1 or more, %s mode", async (mode) => {
    const app = await openWizard(mode);
    await using _screen = app.screen;
    const samples = sampleText(dialog()!);
    // Not vacuous: the dialog's headline, body, link and button texts were all really sampled.
    for (const text of ["Aetheria", "Connect your computers", "Continue", "privacy policy"]) {
      expect(
        samples.some((sample) => sample.text.includes(text)),
        `sampled "${text}"`,
      ).toBe(true);
    }
    // Disabled controls are exempt, and are left out before pairs are merged so they cannot hide an enabled one.
    const rows = summarize(samples.filter((sample) => !sample.disabled));
    const failing = rows.filter((row) => row.ratio < 4.5);
    expect(failing.length, `${mode} wizard\n${table(rows)}`).toBe(0);
  });

  it.each(MODES)("names every control, %s mode", async (mode) => {
    const app = await openWizard(mode);
    await using _screen = app.screen;
    const unnamed = interactiveIn(dialog()!)
      .filter((element) => accessibleName(element) === "")
      .map((element) => element.outerHTML.slice(0, 200));
    expect(unnamed).toEqual([]);
  });

  it("keeps the actions T3 decides: Continue, Add a computer and Close are enabled, the step tabs are not", async () => {
    const app = await openWizard("light");
    await using _screen = app.screen;
    const byName = (name: string) =>
      interactiveIn(dialog()!).find((element) => accessibleName(element).includes(name)) as
        | HTMLButtonElement
        | undefined;
    expect(byName("Continue")?.disabled).toBe(false);
    expect(byName("Add a computer")?.disabled).toBe(false);
    expect(byName("Close")?.disabled).toBe(false);
    for (const step of ["Connect, step 1", "Agents, step 2", "Projects, step 3"]) {
      expect(byName(step)?.disabled, step).toBe(true);
    }
  });

  it("keeps focus inside the dialog while tabbing and reaches Add a computer, the privacy link, Continue and Close", async () => {
    const app = await openWizard("light");
    await using _screen = app.screen;
    const seen = await tabOrder(14);
    expect(seen.length).toBeGreaterThan(3);
    expect(
      seen.every((element) => dialog()!.contains(element)),
      "focus stayed in the dialog",
    ).toBe(true);
    const names = new Set(seen.map((element) => accessibleName(element)));
    for (const expected of ["Add a computer", "privacy policy", "Continue", "Close"]) {
      expect(
        [...names].some((name) => name.includes(expected)),
        `${expected} was reached; saw ${[...names].join(" | ")}`,
      ).toBe(true);
    }
  });

  it("closes with Escape or its Close button and lands on the home route", async () => {
    const app = await openWizard("light");
    await using _screen = app.screen;
    const close = interactiveIn(dialog()!).find((element) => accessibleName(element) === "Close")!;
    close.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => dialog() === null, { timeout: 10_000 }).toBe(true);
    await expect
      .poll(() => app.router.state.location.pathname, { timeout: 10_000 })
      .not.toBe("/welcome");
  });
});

const ROWS: readonly UpdateEverythingRow[] = [
  { environmentId: null, label: "This app", app: "this-app", skipped: null, providers: ["Codex"] },
  {
    environmentId: ENVIRONMENT_ID as EnvironmentId,
    label: "Render scenarios",
    app: "server",
    skipped: null,
    providers: ["Claude", "Codex"],
  },
  {
    environmentId: EnvironmentId.make("environment-offline"),
    label: "Old laptop",
    app: null,
    skipped: "Offline",
    providers: [],
  },
];

describe("the update dialog, driven with fixture state", () => {
  function Harness({
    onConfirm,
    extra,
  }: {
    readonly onConfirm: () => void;
    readonly extra?: Partial<React.ComponentProps<typeof UpdateEverythingDialog>>;
  }) {
    const [open, setOpen] = useState(false);
    return (
      <div className="bg-background p-6 text-foreground">
        <button type="button" onClick={() => setOpen(true)}>
          Open update
        </button>
        <UpdateEverythingDialog
          open={open}
          onOpenChange={setOpen}
          version="1.2.3"
          providerCount={2}
          rows={ROWS}
          restarts={[]}
          onConfirm={onConfirm}
          {...extra}
        />
      </div>
    );
  }

  async function openUpdate(
    mode: Mode,
    extra?: Partial<React.ComponentProps<typeof UpdateEverythingDialog>>,
  ) {
    await prepare(1280, 800, mode);
    // The app paints its canvas on the page; a bare harness has none, so the dialog's translucent glass would
    // be measured over white. Give the page the canvas the real app gives it.
    document.body.style.backgroundColor = "var(--background)";
    const onConfirm = vi.fn();
    const screen = await render(<Harness onConfirm={onConfirm} {...(extra ? { extra } : {})} />);
    const trigger = screen.container.querySelector("button")!;
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => dialog() !== null, { timeout: 5000 }).toBe(true);
    await expect
      .poll(() => dialog()?.innerText.includes("Machine") ?? false, { timeout: 10_000 })
      .toBe(true);
    await dialogSettled();
    return { screen, onConfirm, trigger };
  }

  it.each(MODES)("shows Aetheria's name and the version, not T3 Code, %s mode", async (mode) => {
    const { screen } = await openUpdate(mode);
    await using _screen = screen;
    const text = dialog()!.innerText;
    expect(text).toContain("Aetheria 1.2.3");
    expect(text).toContain("2 provider updates");
    expect(text).toContain("Update 2 machines?");
    expect(text).not.toContain("T3 Code");
    const header = [...dialog()!.querySelectorAll("span")].map((span) => span.textContent);
    expect(header).toContain("Aetheria");
  });

  it.each(MODES)("paints every enabled text pair at 4.5:1 or more, %s mode", async (mode) => {
    const { screen } = await openUpdate(mode);
    await using _screen = screen;
    const samples = sampleText(dialog()!);
    for (const text of [
      "Update 2 machines?",
      "Aetheria",
      "Machine",
      "Providers",
      "Cancel",
      "Update",
    ]) {
      expect(
        samples.some((sample) => sample.text.includes(text)),
        `sampled "${text}"`,
      ).toBe(true);
    }
    const rows = summarize(samples.filter((sample) => !sample.disabled));
    const failing = rows.filter((row) => row.ratio < 4.5);
    expect(failing.length, `${mode} update dialog\n${table(rows)}`).toBe(0);
  });

  it.each(MODES)("names every control and the dialog itself, %s mode", async (mode) => {
    const { screen } = await openUpdate(mode);
    await using _screen = screen;
    const unnamed = interactiveIn(dialog()!)
      .filter((element) => accessibleName(element) === "")
      .map((element) => element.outerHTML.slice(0, 200));
    expect(unnamed).toEqual([]);
    const labelled = dialog()!.getAttribute("aria-labelledby");
    expect(labelled, "the dialog is labelled by its title").not.toBeNull();
    expect(document.getElementById(labelled!)?.textContent).toBe("Update 2 machines?");
  });

  it("focuses Cancel first, keeps focus inside, closes with Escape and returns focus to the trigger", async () => {
    const { screen, trigger } = await openUpdate("light");
    await using _screen = screen;
    expect(accessibleName(document.activeElement!)).toBe("Cancel");
    const seen = await tabOrder(6);
    expect(seen.every((element) => dialog()!.contains(element))).toBe(true);
    expect(seen.some((element) => accessibleName(element) === "Update")).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => dialog() === null, { timeout: 5000 }).toBe(true);
    await expect.poll(() => document.activeElement, { timeout: 5000 }).toBe(trigger);
  });

  it("runs the confirm action once, and Cancel does not confirm", async () => {
    const { screen, onConfirm } = await openUpdate("light");
    await using _screen = screen;
    const buttons = interactiveIn(dialog()!);
    (buttons.find((button) => accessibleName(button) === "Cancel") as HTMLElement).click();
    await expect.poll(() => dialog() === null, { timeout: 5000 }).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    const again = screen.container.querySelector("button")!;
    again.click();
    await expect.poll(() => dialog() !== null, { timeout: 5000 }).toBe(true);
    (
      interactiveIn(dialog()!).find((button) => accessibleName(button) === "Update") as HTMLElement
    ).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables confirm and shows the reason when T3 says so, and disables both buttons while busy", async () => {
    {
      const { screen } = await openUpdate("light", {
        disabledReason: "Wait for the running threads.",
      });
      await using _screen = screen;
      const confirm = interactiveIn(dialog()!).find(
        (button) => accessibleName(button) === "Update",
      ) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      expect(dialog()!.innerText).toContain("Wait for the running threads.");
    }
    {
      const { screen } = await openUpdate("light", { busy: true });
      await using _screen = screen;
      const buttons = interactiveIn(dialog()!).filter((button) =>
        ["Cancel", "Update"].includes(accessibleName(button)),
      ) as HTMLButtonElement[];
      expect(buttons.map((button) => button.disabled)).toEqual([true, true]);
    }
  });

  it.each(MODES)(
    "records the running-thread count colour: it is T3's warning role, measured below 4.5:1 in light mode (a recorded limit), %s mode",
    async (mode) => {
      // The "N running" label is `text-warning` in UpdateEverythingDialog.tsx; the fixture cannot make a thread
      // run, so the same class is measured on the dialog's own surface instead.
      const { screen } = await openUpdate(mode);
      await using _screen = screen;
      const source = (await import("../components/sidebar/UpdateEverythingDialog.tsx?raw")).default;
      expect(source).toContain('className="whitespace-nowrap text-warning"');
      const probe = document.createElement("span");
      probe.className = "whitespace-nowrap text-warning text-sm";
      probe.textContent = "2 running";
      dialog()!.append(probe);
      const surface = surfaceBehind(probe).color;
      const measured = ratio(over(resolveColor(getComputedStyle(probe).color), surface), surface);
      probe.remove();
      if (mode === "light") {
        expect(measured).toBeLessThan(4.5);
        expect(measured).toBeGreaterThanOrEqual(3);
      } else {
        expect(
          measured,
          `surface ${JSON.stringify(surface)} colour ${getComputedStyle(dialog()!).backgroundColor}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
