// The "Stop" on a thread whose run ended but whose provider still has background work (IP-45, M10 step 5): it is the Aetheria tree Stop, once, and never T3's cascading thread.stop.
// Boundary: T3's real useThreadLifecycle hook with every command replaced by a recorder keyed by the command's label; it shows which command a click sends, not what the Backend does.
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const sent = vi.hoisted(() => ({
  calls: [] as Array<{ label: string; input: unknown }>,
  reply: (async () => ({ _tag: "Success", value: undefined })) as () => Promise<unknown>,
}));
const record = (label: string | undefined, input: unknown) => {
  sent.calls.push({ label: label ?? "unlabelled", input });
  return sent.reply();
};

vi.mock(import("../../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: (() => true) as never,
  readEnvironmentScope: (() => true) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: ((command: { label?: string }) => (input: unknown) =>
    record(command.label, input)) as never,
}));
vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: ((command: { label?: string }) => (input: unknown) =>
    record(command.label, input)) as never,
}));
vi.mock(import("../../hooks/useThreadActions"), async (importOriginal) => ({
  ...(await importOriginal()),
  useThreadActions: (() => ({})) as never,
  useAcknowledgeThreadWoke: (() => () => undefined) as never,
}));
vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useChildThreadInputs: (() => []) as never,
}));

import { render } from "../../../test/render";
import { useThreadLifecycle } from "../../components/chat/useThreadLifecycle";

const environmentId = EnvironmentId.make("environment:test");
const ref = scopeThreadRef(environmentId, ThreadId.make("thread:root"));

function Harness() {
  const lifecycle = useThreadLifecycle({
    routeThreadKey: scopedThreadKey(ref),
    activeThread: { id: ref.threadId, environmentId, branch: "main", worktreePath: null } as never,
    activeThreadId: ref.threadId,
    activeThreadRef: ref,
    threadDetailRef: ref,
    activeThreadKey: scopedThreadKey(ref),
    localCheckoutBranchMismatch: null,
    environmentId,
    currentRouteThreadKeyRef: { current: scopedThreadKey(ref) },
    canOperateThread: true,
    clientSettingsHydrated: true,
    activeThreadShell: null,
    activeLatestRun: null as never,
    activeProjectCwd: "/repo",
    serverConfig: null,
    runtimeMode: "full-access" as never,
    isWorking: false,
    pendingBackgroundTasks: [{ taskId: "background-command", kind: "command" }] as never,
    turnItems: [],
    activePendingApproval: null as never,
    activePendingUserInput: null as never,
    gitStatusQuery: { refresh: () => undefined },
    nowMinute: "",
    composerRef: { current: { focusAtEnd: () => undefined } } as never,
    composerDraftTarget: { kind: "thread", ref } as never,
    sendInFlightRef: { current: false },
    setOptimisticUserMessages: () => undefined,
    setThreadError: () => undefined,
    clearUsageLimitsFor: () => undefined,
    beginLocalDispatch: () => undefined,
    resetLocalDispatch: () => undefined,
    scrollToEnd: () => undefined,
    persistThreadSettingsForNextTurn: async () => ({ _tag: "Success", value: undefined }) as never,
  });
  return <>{lifecycle.workNow?.actions}</>;
}

const TREE = {
  ok: true,
  value: { rootThreadId: "thread:root", rows: [], rootStopped: true, complete: true },
};
const treeCalls = () => sent.calls.filter((call) => call.label === "aetheria:children:cancel-tree");

it("one click is exactly one Aetheria cancelTree for the thread, and no other command", async () => {
  sent.calls.length = 0;
  sent.reply = async () => ({ _tag: "Success", value: TREE });
  await using _screen = await render(<Harness />);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Stopping..." })).toBeDisabled();
  expect(sent.calls).toEqual([
    {
      label: "aetheria:children:cancel-tree",
      input: { environmentId, input: { rootThreadId: "thread:root" } },
    },
  ]);
});

it("a second click while it is stopping sends nothing more", async () => {
  sent.calls.length = 0;
  sent.reply = () => new Promise(() => {});
  await using _screen = await render(<Harness />);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Stopping..." })).toBeDisabled();
  await page.getByRole("button", { name: "Stopping..." }).click({ force: true });
  expect(treeCalls()).toHaveLength(1);
  expect(sent.calls).toHaveLength(1);
});

it("a refused Stop lets the person try again; a lost reply stays stopping and is not sent again", async () => {
  sent.calls.length = 0;
  sent.reply = async () => ({
    _tag: "Success",
    value: { ok: false, code: "CHILDREN_NOT_AUTHORIZED" },
  });
  await using _screen = await render(<Harness />);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  expect(treeCalls()).toHaveLength(1);

  sent.calls.length = 0;
  sent.reply = async () => ({
    _tag: "Success",
    value: { ok: false, code: "CHILDREN_OUTCOME_UNKNOWN" },
  });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Stopping..." })).toBeDisabled();
  expect(treeCalls()).toHaveLength(1);
});
