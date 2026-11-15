// The goal card and its one-click Re-arm in a real browser with the real stylesheet (M07 Plan step 18, D24, C8, XC-23). Boundary: the provider, card and authorization card over a SCRIPTED Backend (the
// GoalsTransport), with T3's session-generation atom and the goal change stream replaced by atoms the test moves. This shows what the page reads, sends and says, not the real socket, the real Backend or the
// real M06 grant: step 20's built-app run shows those. The images under __screenshots__/ are evidence for a person to view; the assertions prove the words, the calls, the focus and the layout.
import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { act, render } from "../../../test/render";
import { over, ratio, resolveColor, surfaceBehind } from "../measure";
import type { ControlActions } from "./actions";
import { createDraftStore, type DraftStorage } from "./drafts";
import { GoalsCard } from "./goals/GoalsCard";
import { GoalsProvider } from "./goals/GoalsProvider";
import type { GoalView } from "./goals/reply";
import { GoalsTransportContext } from "./goals/transport";
import type { GoalsTransport } from "./goals/types";
import { InteractionCard } from "./InteractionCard";
import type { InteractionRecord, TransportResult } from "./types";

const mocks = vi.hoisted(() => ({
  generation: null as unknown as Atom.Writable<number>,
  signal: null as unknown as Atom.Writable<unknown>,
}));
// The page's other components read the rest of the real catalog; only the session generation is the test's.
vi.mock("~/connection/catalog", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/connection/catalog")>();
  return {
    ...original,
    environmentCatalog: {
      ...original.environmentCatalog,
      sessionGenerationAtom: () => Atom.make((get) => get(mocks.generation)),
    },
  };
});
vi.mock("./goals/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./goals/commands")>()),
  goalChanges: () => Atom.make((get) => get(mocks.signal)),
}));

type Mode = "light" | "dark";
const ENV = "env-goals";
const ROOT = "pi-root-1";
const DIGEST = "d".repeat(64);
const ORIGIN_NEW = "origin-NEW-5150";
const ORIGIN_CARD = "origin-CARD-9001";
const CASES = ([1280, 390] as const).flatMap((width) =>
  (["light", "dark"] as const).map((mode) => [width, mode] as const),
);

const goal = (over: Partial<GoalView> = {}): GoalView => ({
  goalId: "g-7",
  revision: 4,
  objective: 'Ship the thing\n<img src=x onerror="window.__pwned=1"> **not bold**',
  phase: "active",
  roundsStarted: 2,
  maxRounds: 10,
  armed: true,
  needsRearm: false,
  ...over,
});
const REARM_SUBJECT = { type: "goal-mutation", id: "g-7:4:rearm", revision: DIGEST } as const;
const needsRearm = (over: Partial<GoalView> = {}): GoalView =>
  goal({
    armed: false,
    needsRearm: true,
    interrupted: "backend-restarted",
    rearm: {
      subject: REARM_SUBJECT,
      text: "Re-arm goal g-7 at revision 4: continue 'Ship the thing'",
    },
    ...over,
  });

const reply = (value: unknown): TransportResult => ({ tag: "reply", reply: value });
const ok = (value: unknown) => reply({ ok: true, value });
const fail = (code: string, extra: object = {}) => reply({ ok: false, code, ...extra });
const LOST: TransportResult = { tag: "lost" };

type Call = { readonly method: string; readonly payload: unknown };
type Step = () => Promise<TransportResult> | TransportResult;

/** A scripted Backend: the goal and version it holds, every call it saw, and per-call scripts that run first. */
function world(initial: GoalView | null, version = 3) {
  const state = { goal: initial, version };
  const log: Call[] = [];
  const script = {
    snapshot: [] as Step[],
    grant: [] as Step[],
    rearm: [] as Step[],
  };
  const arm = () => {
    const current = state.goal;
    if (current === null) throw new Error("no goal to arm");
    const { rearm: _offer, interrupted: _interrupted, ...rest } = current;
    state.goal = { ...rest, revision: current.revision + 1, armed: true, needsRearm: false };
    state.version += 1;
    return state.goal;
  };
  const transport: GoalsTransport = {
    snapshot: async (_env, root) => {
      log.push({ method: "snapshot", payload: { root } });
      const next = script.snapshot.shift();
      return next ? next() : ok({ goal: state.goal, version: state.version });
    },
    grant: async (_env, payload) => {
      log.push({ method: "grant", payload });
      const next = script.grant.shift();
      return next ? next() : ok({ originId: ORIGIN_NEW });
    },
    rearm: async (_env, payload) => {
      log.push({ method: "rearm", payload });
      const next = script.rearm.shift();
      return next ? next() : ok({ goal: arm() });
    },
  };
  return { state, log, script, transport, arm };
}
type World = ReturnType<typeof world>;
const callsOf = (w: World, method: string) => w.log.filter((call) => call.method === method);

function setupAtoms() {
  mocks.generation = Atom.make(1);
  mocks.signal = Atom.make<unknown>(AsyncResult.success({ tag: "opened" }));
}
let pushes = 0;
const push = (version: number, root = ROOT) =>
  act(async () =>
    appAtomRegistry.set(
      mocks.signal,
      AsyncResult.success({
        tag: "event",
        n: ++pushes,
        event: { rootSessionId: root, version },
      }),
    ),
  );
const newSession = (generation: number) =>
  act(async () => appAtomRegistry.set(mocks.generation, generation));

function Page(props: { readonly w: World; readonly root?: string; readonly children?: ReactNode }) {
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <GoalsTransportContext value={props.w.transport}>
        <GoalsProvider
          key={props.root ?? ROOT}
          environmentId={ENV}
          rootSessionId={props.root ?? ROOT}
        >
          <main className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-3 p-4">
            {props.children ?? <GoalsCard />}
          </main>
        </GoalsProvider>
      </GoalsTransportContext>
    </RegistryContext.Provider>
  );
}

async function appear(width: number, mode: Mode) {
  await page.viewport(width, width === 390 ? 844 : 900);
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
}
const card = () => document.querySelector<HTMLElement>("[data-aetheria='goals']")!;
const view = () => card().getAttribute("data-goal-view");
const headline = () =>
  card().querySelector("[data-goal-headline]")?.getAttribute("data-goal-headline") ?? null;
const rearmButton = () => card().querySelector<HTMLButtonElement>("[data-rearm='ready']");
const shot = (name: string, width: number, mode: Mode) =>
  page.screenshot({
    base64: true,
    path: `__screenshots__/goals-${name}-${width}-${mode}.png`,
    save: true,
  });
const flush = () =>
  act(async () => {
    for (let step = 0; step < 25; step++) await Promise.resolve();
  });
const noOverflow = () =>
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

class MemoryStorage implements DraftStorage {
  readonly map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
  keys = () => [...this.map.keys()];
}

describe("the goal card shows the Backend's state honestly", () => {
  it.each(CASES)(
    "each goal state is told apart, with no overflow, at %i px, %s",
    async (width, mode) => {
      await appear(width, mode);
      const states: ReadonlyArray<readonly [string, GoalView, RegExp]> = [
        ["needs-rearm", needsRearm(), /not armed.*re-armed/i],
        [
          "awaiting-human",
          needsRearm({ awaitingHuman: { proposalId: "p-1", interactionId: "i-9" } }),
          /waiting for a person/i,
        ],
        [
          "blocked-round-limit",
          goal({
            phase: "blocked",
            armed: false,
            roundsStarted: 10,
            blocker: { code: "round-limit", message: "" },
          }),
          /round limit/i,
        ],
        [
          "blocked",
          goal({
            phase: "blocked",
            armed: false,
            blocker: { code: "model", message: "cannot reach" },
          }),
          /Blocked/,
        ],
        ["paused", goal({ phase: "paused", armed: false }), /Paused/],
        ["armed", goal(), /Active and armed/],
        ["complete", goal({ phase: "complete", armed: false }), /Complete/],
      ];
      for (const [expected, state, words] of states) {
        setupAtoms();
        const w = world(state);
        await using screen = await render(<Page w={w} />, { router: false });
        await expect.poll(() => view()).toBe("live");
        expect(headline()).toBe(expected);
        expect(card().textContent).toMatch(words);
        // Only the goal's own offer shows a Re-arm; the flag alone never does.
        expect(rearmButton() !== null).toBe(state.rearm !== undefined);
        expect(card().querySelectorAll("img, script")).toHaveLength(0);
        noOverflow();
        const headlineText = card().querySelector<HTMLElement>("[data-goal-headline] p")!;
        const behind = surfaceBehind(headlineText);
        expect(
          ratio(
            over(resolveColor(getComputedStyle(headlineText).color), behind.color),
            behind.color,
          ),
        ).toBeGreaterThanOrEqual(4.5);
        if (expected === "needs-rearm") await shot("needs-rearm", width, mode);
        await screen.unmount();
      }
    },
  );

  it.each(CASES)(
    "an interrupted round, hostile text, and long ids stay inside the card at %i px, %s",
    async (width, mode) => {
      await appear(width, mode);
      setupAtoms();
      const w = world(
        needsRearm({
          goalId: `g-${"x".repeat(80)}`,
          rearm: {
            subject: { ...REARM_SUBJECT, id: `g-${"x".repeat(80)}:4:rearm` },
            text: `Re-arm ${"very-long-token-".repeat(12)}`,
          },
        }),
      );
      await using _screen = await render(<Page w={w} />, { router: false });
      await expect.poll(() => view()).toBe("live");
      expect(card().textContent).toMatch(
        /restarted while a round was running; that round was interrupted/,
      );
      // The objective is shown as text: the markup in it never became an element and never ran.
      expect(card().querySelector("[data-raw-text]")?.textContent).toContain("<img src=x");
      expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
      noOverflow();
    },
  );

  it.each([
    ["GOALS_UNAVAILABLE", "unavailable", /goal is unavailable/i],
    ["GOALS_OUTCOME_UNKNOWN", "unavailable", /not known/i],
  ] as const)(
    "%s is unavailable or unknown and never says there is no goal",
    async (code, shown, words) => {
      await appear(390, "light");
      setupAtoms();
      const w = world(goal());
      w.script.snapshot.push(() => fail(code, { detail: "the service is not running" }));
      await using _screen = await render(<Page w={w} />, { router: false });
      await expect.poll(() => view()).toBe(shown);
      expect(card().textContent).toMatch(words);
      expect(card().textContent).toContain("the service is not running");
      expect(card().querySelector("[data-goal-empty]")).toBeNull();
      expect(card().textContent).not.toMatch(/no goal for this session/i);
      await shot(`problem-${code}`, 390, "light");
    },
  );

  it("a refusal shows the code and no goal; no goal is its own plain statement", async () => {
    await appear(1280, "light");
    setupAtoms();
    const refused = world(goal());
    refused.script.snapshot.push(() =>
      fail("GOALS_DEVICE_REVOKED", { detail: "this device was revoked" }),
    );
    {
      await using _screen = await render(<Page w={refused} />, { router: false });
      await expect.poll(() => view()).toBe("refused");
      expect(card().querySelector("[data-refusal-code]")?.getAttribute("data-refusal-code")).toBe(
        "GOALS_DEVICE_REVOKED",
      );
      expect(card().querySelector("[data-goal-headline]")).toBeNull();
    }
    setupAtoms();
    const none = world(null);
    await using _again = await render(<Page w={none} />, { router: false });
    await expect.poll(() => view()).toBe("live");
    expect(card().querySelector("[data-goal-empty]")?.textContent).toBe(
      "The Backend holds no goal for this session.",
    );
  });

  it("the old static statement is gone; without a provider the card reads nothing and says so", async () => {
    await appear(1280, "light");
    await using _screen = await render(<GoalsCard />, { router: false });
    expect(document.body.textContent).not.toContain("not built yet");
    expect(card().getAttribute("data-goal-view")).toBe("no-session");
    expect(card().querySelectorAll("button")).toHaveLength(0);
  });
});

describe("pushes, order and stale views", () => {
  it("subscribes before it reads, a push only prompts a re-read, and the newest version wins", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world(needsRearm());
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => view()).toBe("live");
    expect(callsOf(w, "snapshot")).toHaveLength(1);

    // The Backend moves on; the push carries no goal, only a version, and the view changes only after the re-read.
    w.state.goal = goal({ revision: 5 });
    w.state.version = 4;
    await push(4);
    await expect.poll(() => headline()).toBe("armed");
    expect(callsOf(w, "snapshot")).toHaveLength(2);

    // An older push changes nothing and reads nothing.
    await push(3);
    await flush();
    expect(callsOf(w, "snapshot")).toHaveLength(2);
    expect(headline()).toBe("armed");
  });

  it("an older reply that lands after a newer one never replaces it", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world(goal({ revision: 5, phase: "paused", armed: false }), 5);
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => headline()).toBe("paused");
    let release!: (value: TransportResult) => void;
    w.script.snapshot.push(() => new Promise<TransportResult>((resolve) => (release = resolve)));
    await push(6);
    await expect.poll(() => callsOf(w, "snapshot").length).toBe(2);
    // The slow reply is for an older version than the one held.
    release(ok({ goal: goal({ revision: 3 }), version: 4 }));
    await flush();
    expect(headline()).toBe("paused");
  });

  it("a read that fails after a good one keeps the goal marked stale and offers no Re-arm until it reads again", async () => {
    await appear(390, "dark");
    setupAtoms();
    const w = world(needsRearm());
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => rearmButton()).not.toBeNull();
    w.script.snapshot.push(() => LOST);
    await push(4);
    await expect.poll(() => view()).toBe("stale");
    expect(card().textContent).toMatch(/may be out of date/);
    expect(rearmButton()).toBeNull();
    expect(card().querySelector("[data-rearm-held]")?.textContent).toMatch(
      /not offered until the goal is read again/,
    );
    await shot("stale", 390, "dark");

    // A new session of the connection reads again, and the offer returns only with the live read.
    await newSession(2);
    await expect.poll(() => view()).toBe("live");
    expect(rearmButton()).not.toBeNull();
  });

  it("a reconnect that loses its first read stays unavailable and does not loop", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world(goal());
    w.script.snapshot.push(
      () => LOST,
      () => LOST,
    );
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => view()).toBe("unavailable");
    await flush();
    expect(callsOf(w, "snapshot")).toHaveLength(1);
    await newSession(2);
    await expect.poll(() => callsOf(w, "snapshot").length).toBe(2);
    await flush();
    expect(callsOf(w, "snapshot")).toHaveLength(2);
    expect(view()).toBe("unavailable");
  });
});

describe("one-click Re-arm", () => {
  it("grants for the exact subject the card shows, passes the grant once, and says re-armed only after the read-back", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world(needsRearm());
    await using screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => rearmButton()).not.toBeNull();
    // The exact text and subject the person is authorizing are on the page before the click.
    expect(card().querySelector("[data-rearm-offer] [data-raw-text]")?.textContent).toBe(
      needsRearm().rearm?.text,
    );
    expect(card().querySelector("[data-rearm-offer]")?.textContent).toContain("g-7:4:rearm");
    await screen.getByRole("button", { name: "Re-arm" }).click();
    await expect
      .poll(() => card().querySelector("[data-rearm-status]")?.getAttribute("data-rearm-status"))
      .toBe("confirmed");
    expect(w.log.map((call) => call.method)).toEqual(["snapshot", "grant", "rearm", "snapshot"]);
    expect(callsOf(w, "grant")[0]?.payload).toEqual({ subject: REARM_SUBJECT, sessionId: ROOT });
    expect(callsOf(w, "rearm")[0]?.payload).toEqual({
      rootSessionId: ROOT,
      goalId: "g-7",
      revision: 4,
      originId: ORIGIN_NEW,
    });
    expect(card().textContent).toMatch(/^.*Re-armed: the Backend's goal read back at revision 5/s);
    expect(headline()).toBe("armed");
    // The origin id was sent once to the Re-arm and is nowhere on the page.
    expect(document.documentElement.outerHTML).not.toContain(ORIGIN_NEW);
    expect(rearmButton()).toBeNull();
    // The goal changed under the button: focus went to the card that says what happened.
    await expect.poll(() => document.activeElement).toBe(card());
    await shot("rearmed", 1280, "light");
  });

  it("works from the keyboard: Tab to Re-arm, Enter once, one grant and one Re-arm", async () => {
    await appear(390, "light");
    setupAtoms();
    const w = world(needsRearm());
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => rearmButton()).not.toBeNull();
    const button = rearmButton()!;
    button.focus();
    expect(document.activeElement).toBe(button);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => callsOf(w, "rearm").length).toBe(1);
    await flush();
    expect(callsOf(w, "grant")).toHaveLength(1);
    expect(card().getAttribute("aria-busy")).toBe("false");
  });

  it("is at least 44 px to touch on the phone and keeps a visible focus ring", async () => {
    await appear(390, "light");
    setupAtoms();
    const w = world(needsRearm());
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => rearmButton()).not.toBeNull();
    const rect = rearmButton()!.getBoundingClientRect();
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.width).toBeGreaterThanOrEqual(44);
    await userEvent.tab();
    const focused = document.activeElement as HTMLElement;
    expect(focused.matches("[data-rearm='ready']")).toBe(true);
    const ring = getComputedStyle(focused);
    expect(ring.outlineStyle !== "none" || ring.boxShadow !== "none").toBe(true);
  });

  it("a double click sends one grant and one Re-arm", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world(needsRearm());
    let release!: (value: TransportResult) => void;
    w.script.grant.push(() => new Promise<TransportResult>((resolve) => (release = resolve)));
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => rearmButton()).not.toBeNull();
    const button = rearmButton()!;
    button.click();
    button.click();
    await expect.poll(() => button.getAttribute("aria-disabled")).toBe("true");
    release(ok({ originId: ORIGIN_NEW }));
    await expect.poll(() => callsOf(w, "rearm").length).toBe(1);
    await flush();
    expect(callsOf(w, "grant")).toHaveLength(1);
  });

  it("a lost Re-arm reply is unknown, is not sent again, reads the goal and offers a new deliberate click", async () => {
    await appear(390, "light");
    setupAtoms();
    const w = world(needsRearm());
    w.script.rearm.push(() => LOST);
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => rearmButton()).not.toBeNull();
    rearmButton()!.click();
    await expect
      .poll(() => card().querySelector("[data-rearm-status]")?.getAttribute("data-rearm-status"))
      .toBe("unknown");
    expect(card().textContent).toMatch(/not sent again/);
    expect(card().textContent).not.toMatch(/Re-armed:/);
    expect(callsOf(w, "grant")).toHaveLength(1);
    expect(callsOf(w, "rearm")).toHaveLength(1);
    // The goal was read again (the Backend never applied it here) and still offers Re-arm; nothing repeated by itself.
    expect(callsOf(w, "snapshot")).toHaveLength(2);
    await flush();
    expect(callsOf(w, "rearm")).toHaveLength(1);
    await shot("rearm-unknown", 390, "light");
    // The person's own second click is a new grant and a new Re-arm.
    rearmButton()!.click();
    await expect.poll(() => callsOf(w, "rearm").length).toBe(2);
    expect(callsOf(w, "grant")).toHaveLength(2);
  });

  it("a lost grant reply sends no Re-arm at all", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world(needsRearm());
    w.script.grant.push(() => LOST);
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => rearmButton()).not.toBeNull();
    rearmButton()!.click();
    await expect
      .poll(() => card().querySelector("[data-rearm-status]")?.getAttribute("data-rearm-status"))
      .toBe("unknown");
    expect(card().textContent).toMatch(/no Re-arm was sent/);
    expect(callsOf(w, "rearm")).toHaveLength(0);
  });

  it("a refused or consumed origin shows the Backend's code and words and changes nothing", async () => {
    await appear(1280, "dark");
    setupAtoms();
    const w = world(needsRearm());
    w.script.rearm.push(() =>
      fail("GOAL_ORIGIN_CONSUMED", { detail: "that grant was already used", field: "originId" }),
    );
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => rearmButton()).not.toBeNull();
    rearmButton()!.click();
    await expect
      .poll(() => card().querySelector("[data-rearm-status]")?.getAttribute("data-rearm-status"))
      .toBe("refused");
    expect(card().querySelector("[data-refusal-code]")?.getAttribute("data-refusal-code")).toBe(
      "GOAL_ORIGIN_CONSUMED",
    );
    // The Backend's words are on the page exactly as supplied (an unknown code's words are its title), with the failed field.
    expect(card().querySelector("[data-refusal-code]")?.textContent).toContain(
      "that grant was already used (originId)",
    );
    expect(headline()).toBe("needs-rearm");
    await shot("rearm-refused", 1280, "dark");
  });

  it("two clients racing: the loser is told the goal changed, shows the current goal, and re-arms nothing", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world(needsRearm());
    // Another client re-armed first: this client's reference is stale and the Backend supplies the current view.
    w.script.rearm.push(() => {
      const current = w.arm();
      return fail("GOAL_STALE_REVISION", { detail: "revision 4 is not current", current });
    });
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => rearmButton()).not.toBeNull();
    rearmButton()!.click();
    await expect
      .poll(() => card().querySelector("[data-rearm-status]")?.getAttribute("data-rearm-status"))
      .toBe("refused");
    expect(card().textContent).toMatch(/goal changed after you saw it \(it is now revision 5\)/);
    // The re-read adopted the current goal, which no longer offers Re-arm.
    await expect.poll(() => headline()).toBe("armed");
    expect(rearmButton()).toBeNull();
    expect(callsOf(w, "rearm")).toHaveLength(1);
    expect(card().textContent).not.toMatch(/Re-armed:/);
  });

  it("GOALS_UNAVAILABLE says the Backend did nothing", async () => {
    await appear(390, "light");
    setupAtoms();
    const w = world(needsRearm());
    w.script.rearm.push(() =>
      fail("GOALS_UNAVAILABLE", { detail: "the goal service is not running" }),
    );
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => rearmButton()).not.toBeNull();
    rearmButton()!.click();
    await expect
      .poll(() => card().querySelector("[data-rearm-status]")?.getAttribute("data-rearm-status"))
      .toBe("unavailable");
    expect(card().textContent).toMatch(/did nothing: the goal service is not running/);
  });

  it("a reply that lands after the root changed lands nowhere: the new root's view and calls are untouched", async () => {
    await appear(1280, "light");
    setupAtoms();
    const a = world(needsRearm());
    let release!: (value: TransportResult) => void;
    a.script.rearm.push(() => new Promise<TransportResult>((resolve) => (release = resolve)));
    const screen = await render(<Page w={a} root="root-A" />, { router: false });
    await expect.poll(() => rearmButton()).not.toBeNull();
    rearmButton()!.click();
    await expect.poll(() => callsOf(a, "rearm").length).toBe(1);

    // The page moves to another root while the Re-arm is away.
    const b = world(goal({ goalId: "g-B", phase: "paused", armed: false }), 9);
    await screen.rerender(<Page w={b} root="root-B" />);
    await expect.poll(() => headline()).toBe("paused");
    release(ok({ goal: goal({ revision: 5 }) }));
    await flush();
    expect(headline()).toBe("paused");
    expect(card().textContent).not.toMatch(/Re-armed/);
    expect(b.log.map((call) => call.method)).toEqual(["snapshot"]);
    await screen.unmount();
  });

  it("unmounting mid-flight calls nothing that cancels or changes the goal", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world(needsRearm());
    let release!: (value: TransportResult) => void;
    w.script.rearm.push(() => new Promise<TransportResult>((resolve) => (release = resolve)));
    const screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => rearmButton()).not.toBeNull();
    rearmButton()!.click();
    await expect.poll(() => callsOf(w, "rearm").length).toBe(1);
    await screen.unmount();
    release(ok({ goal: goal({ revision: 5 }) }));
    await flush();
    expect(new Set(w.log.map((call) => call.method))).toEqual(
      new Set(["snapshot", "grant", "rearm"]),
    );
    expect(callsOf(w, "rearm")).toHaveLength(1);
  });
});

describe("an authorization card is tied to the goal's own Re-arm only", () => {
  const authorization = (subject: { type: string; id: string; revision: string }) =>
    ({
      interactionId: "a-1",
      state: "answered",
      revision: "e".repeat(64),
      rootSessionId: ROOT,
      sessionId: ROOT,
      createdAt: "2026-01-01T00:00:00Z",
      held: false,
      kind: "authorization",
      content: { text: "Re-arm goal g-7 at revision 4", subject },
      resolution: {
        type: "answers",
        answers: [{ id: "authorization", selected: ["Approve"], skipped: false }],
        originId: ORIGIN_CARD,
      },
    }) as unknown as InteractionRecord;
  const cardFor = (subject: { type: string; id: string; revision: string }) => (
    <>
      <GoalsCard />
      <InteractionCard
        record={authorization(subject)}
        actions={{} as ControlActions}
        drafts={createDraftStore(new MemoryStorage())}
      />
    </>
  );
  const authButton = () =>
    document.querySelector<HTMLButtonElement>("[data-interaction] [data-rearm]");

  it("enables Re-arm only for the goal's current subject, and then runs a fresh grant, never the card's origin", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world(needsRearm());
    await using _screen = await render(<Page w={w}>{cardFor(REARM_SUBJECT)}</Page>, {
      router: false,
    });
    await expect.poll(() => authButton()?.getAttribute("data-rearm")).toBe("ready");
    authButton()!.click();
    await expect.poll(() => callsOf(w, "rearm").length).toBe(1);
    expect(callsOf(w, "grant")).toHaveLength(1);
    const rearmCall = callsOf(w, "rearm")[0]!.payload as { originId: string };
    expect(rearmCall.originId).toBe(ORIGIN_NEW);
    expect(JSON.stringify(w.log)).not.toContain(ORIGIN_CARD);
    // The card's own origin is shown once as supplied; the new one is on no page.
    expect(document.documentElement.outerHTML.split(ORIGIN_CARD)).toHaveLength(2);
    expect(document.documentElement.outerHTML).not.toContain(ORIGIN_NEW);
  });

  it.each([
    ["another id", { ...REARM_SUBJECT, id: "g-7:3:rearm" }],
    ["another revision", { ...REARM_SUBJECT, revision: "c".repeat(64) }],
    ["another type", { ...REARM_SUBJECT, type: "tool-call" }],
  ])("a card for %s keeps Re-arm disabled and says why", async (_name, subject) => {
    await appear(390, "light");
    setupAtoms();
    const w = world(needsRearm());
    await using _screen = await render(<Page w={w}>{cardFor(subject)}</Page>, { router: false });
    await expect.poll(() => view()).toBe("live");
    const button = authButton()!;
    expect(button.getAttribute("data-rearm")).toBe("held");
    expect(button.disabled).toBe(true);
    expect(document.querySelector("[data-interaction]")?.textContent).toMatch(/another subject/);
    expect(callsOf(w, "grant")).toHaveLength(0);
    await shot("card-held", 390, "light");
  });

  it("a card with no live goal view keeps Re-arm disabled", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world(needsRearm());
    w.script.snapshot.push(() => LOST);
    await using _screen = await render(<Page w={w}>{cardFor(REARM_SUBJECT)}</Page>, {
      router: false,
    });
    await expect.poll(() => view()).toBe("unavailable");
    expect(authButton()?.getAttribute("data-rearm")).toBe("held");
    expect(document.querySelector("[data-interaction]")?.textContent).toMatch(
      /being read or may be out of date/,
    );
  });
});
