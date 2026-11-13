// IP-61, the real ThreadTerminalDrawer in Chromium over recording fakes (surface, session, scope, write command): the authority label is on screen with and without a terminal; a write to an
// exited terminal is not sent and says the process exited; a write to a running one is sent. Not shown: T3's server answering a write (the native terminal case), a real PTY, the Ghostty renderer.
import { EMPTY_TERMINAL_SESSION_STATE } from "@t3tools/client-runtime/state/terminal";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import type { GhosttyTerminalSurfaceOptions } from "~/terminal/ghostty/surface";
import { act, render } from "../../../test/render";
import ThreadTerminalDrawer from "../../components/ThreadTerminalDrawer";
import { ENDED_WRITE_EXITED } from "./endedWrite";
import { TERMINAL_AUTHORITY } from "./notice";

const fixture = vi.hoisted(() => ({
  status: "running" as "running" | "exited",
  pendingSurfaces: [] as Array<() => void>,
  surfaceOptions: [] as GhosttyTerminalSurfaceOptions[],
  surfaceWrites: [] as string[],
  commands: [] as Array<{ command: unknown; input: unknown }>,
}));

// Every surface method is a no-op except `write`, which records what the drawer prints into the terminal; `then` stays undefined so awaiting the surface resolves to it.
const fakeSurface: object = new Proxy(
  { input: document.createElement("textarea") },
  {
    get: (target, key) =>
      key === "then"
        ? undefined
        : key === "write"
          ? (data: string) => void fixture.surfaceWrites.push(data)
          : key in target
            ? Reflect.get(target, key)
            : () => undefined,
  },
);
vi.mock("~/terminal/ghostty/surface", () => ({
  GhosttyTerminalSurface: {
    create: (_mount: HTMLElement, options: GhosttyTerminalSurfaceOptions) =>
      new Promise((resolve) => {
        fixture.surfaceOptions.push(options);
        fixture.pendingSurfaces.push(() => resolve(fakeSurface));
      }),
  },
}));
vi.mock("../../state/terminalSessions", async () => {
  const Atom = await import("effect/reactivity/Atom");
  const running = Atom.make({
    ...EMPTY_TERMINAL_SESSION_STATE,
    status: "running" as const,
    version: 1,
  });
  const exited = Atom.make({
    ...EMPTY_TERMINAL_SESSION_STATE,
    status: "exited" as const,
    version: 1,
  });
  return { attachedTerminalSessionAtom: () => (fixture.status === "exited" ? exited : running) };
});
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => async (input: unknown) => {
    fixture.commands.push({ command, input });
    return { _tag: "Success" };
  },
}));
vi.mock("../../state/server", async () => {
  const Atom = await import("effect/reactivity/Atom");
  const config = Atom.make(null);
  return { serverEnvironment: { configValueAtom: () => config } };
});
vi.mock("../../state/terminal", () => ({
  terminalEnvironment: { write: { name: "write" }, resize: { name: "resize" } },
}));
vi.mock("../../state/preview", () => ({ previewEnvironment: { open: {} } }));
vi.mock("../../state/projects", () => ({ projectEnvironment: { fileMetadata: () => null } }));
vi.mock("../../editorPreferences", () => ({ useOpenInPreferredEditor: () => () => {} }));
vi.mock("../../components/preview/openTerminalLinkInPreview", () => ({
  openTerminalLinkInPreview: () => {},
}));
vi.mock("~/localApi", () => ({ readLocalApi: () => null }));
vi.mock("../../hooks/useSettings", async () => {
  const { DEFAULT_CLIENT_SETTINGS } = await import("@t3tools/contracts/settings");
  return {
    useClientSettings: <T,>(select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => T) =>
      select(DEFAULT_CLIENT_SETTINGS),
  };
});

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-a"),
  threadId: ThreadId.make("thread-a"),
};

function Drawer(props: { terminalIds: string[] }) {
  const [first] = props.terminalIds;
  return (
    <ThreadTerminalDrawer
      threadRef={threadRef}
      threadId={threadRef.threadId}
      cwd="/repo"
      height={240}
      terminalIds={props.terminalIds}
      activeTerminalId={first ?? "term-1"}
      terminalGroups={
        first === undefined ? [] : [{ id: "group-1", terminalIds: props.terminalIds }]
      }
      activeTerminalGroupId="group-1"
      onSplitTerminal={() => {}}
      onSplitTerminalVertical={() => {}}
      onNewTerminal={() => {}}
      onActiveTerminalChange={() => {}}
      onCloseTerminal={() => {}}
      onHeightChange={() => {}}
      onAddTerminalContext={() => {}}
      keybindings={[]}
    />
  );
}

function reset(status: "running" | "exited") {
  fixture.status = status;
  fixture.pendingSurfaces = [];
  fixture.surfaceOptions = [];
  fixture.surfaceWrites = [];
  fixture.commands = [];
}
const writesSent = () =>
  fixture.commands.filter((c) => (c.command as { name?: string }).name === "write");

it("shows the authority label in the drawer, with a terminal and with none", async () => {
  reset("running");
  await using withTerminal = await render(<Drawer terminalIds={["term-1"]} />);
  await expect.element(withTerminal.getByText(TERMINAL_AUTHORITY)).toBeVisible();
  expect(
    withTerminal.container.querySelectorAll('[data-aetheria="terminal-authority"]'),
  ).toHaveLength(1);
  await using none = await render(<Drawer terminalIds={[]} />);
  await expect.element(none.getByText(TERMINAL_AUTHORITY)).toBeVisible();
});

it("does not send a write to an exited terminal and tells the person the process has exited, once", async () => {
  reset("exited");
  await using _screen = await render(<Drawer terminalIds={["term-1"]} />);
  await act(async () => {
    fixture.pendingSurfaces.shift()?.();
  });
  const options = fixture.surfaceOptions.at(-1)!;
  await act(async () => {
    options.onData!("ls\n");
    options.onData!("pwd\n");
  });
  expect(writesSent()).toEqual([]);
  const told = fixture.surfaceWrites.filter((w) => w.includes(ENDED_WRITE_EXITED));
  expect(told).toHaveLength(1);
  expect(told[0]).toContain("not delivered");
});

it("sends a write to a running terminal and adds no words", async () => {
  reset("running");
  await using _screen = await render(<Drawer terminalIds={["term-1"]} />);
  await act(async () => {
    fixture.pendingSurfaces.shift()?.();
  });
  await act(async () => {
    fixture.surfaceOptions.at(-1)!.onData!("ls\n");
  });
  expect(writesSent().map((c) => (c.input as { input: { data: string } }).input.data)).toEqual([
    "ls\n",
  ]);
  expect(fixture.surfaceWrites.some((w) => w.includes("not delivered"))).toBe(false);
});
