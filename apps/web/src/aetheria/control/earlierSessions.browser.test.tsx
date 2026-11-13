// The question a replaced session left open appears on the control page of the thread now bound to its replacement (M10 review 1, follow-up 4b). Boundary: `ControlPanel` and the real `useInteractions`
// over a FAKE transport (the Backend's two snapshots: the live root's, naming a replaced root, and the replaced root's own), with T3's session-generation atom and change stream replaced by atoms.
// It shows what the page lists and says, and that an action on the earlier session's question is confirmed by a re-read that includes it; it does not show the real socket or the Backend's alias rule
// (apps/server and packages/aetheria-server own those).
import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { render } from "../../../test/render";
import type { ControlTransport, TransportResult } from "./types";

const mocks = vi.hoisted(() => ({ transport: null as unknown as ControlTransport }));
vi.mock("~/connection/catalog", () => ({
  environmentCatalog: { sessionGenerationAtom: () => Atom.make(1) },
}));
vi.mock("./transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./transport")>()),
  interactionChanges: () => Atom.make(AsyncResult.success({ tag: "opened" })),
}));
vi.mock("./useControl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useControl")>()),
  useControlTransport: () => mocks.transport,
}));

import { ControlPanel } from "./ControlPanel";
import { browserDraftStorage, createDraftStore } from "./drafts";

const ENV = "env-control";
const LIVE = "pi-root-live";
const OLD = "pi-root-old";
const question = (id: string, root: string, text: string) => ({
  interactionId: id,
  state: "pending",
  revision: "a1".repeat(32),
  rootSessionId: root,
  sessionId: root,
  createdAt: "2026-11-11T00:00:00.000Z",
  held: false,
  kind: "question",
  content: { questions: [{ id: "q1", question: text }] },
});
const reply = (value: unknown): TransportResult => ({ tag: "reply", reply: { ok: true, value } });

function transportOver(options: { readonly oldReadFails?: boolean }) {
  const snapshot = vi.fn(async (_env: string, root: string): Promise<TransportResult> => {
    if (root === LIVE) {
      return reply({
        rootSessionId: LIVE,
        version: 5,
        interactions: [question("live-1", LIVE, "Live question?")],
        retiredRoots: [OLD],
      });
    }
    if (options.oldReadFails === true) return { tag: "lost" };
    return reply({
      rootSessionId: OLD,
      version: 2,
      interactions: [question("old-1", OLD, "Earlier question?")],
    });
  });
  mocks.transport = {
    snapshot,
    planModeGet: async () => reply({ sessionId: LIVE, mode: "off" }),
    tasksGet: async () => reply(null),
  } as unknown as ControlTransport;
  return snapshot;
}

const panel = () => (
  <RegistryContext.Provider value={appAtomRegistry}>
    <ControlPanel
      environmentId={ENV}
      rootSessionId={LIVE}
      drafts={createDraftStore(browserDraftStorage())}
    />
  </RegistryContext.Provider>
);

it("lists the question the replaced session asked beside the live one, and says it is from an earlier session of this thread", async () => {
  const snapshot = transportOver({});
  await using _screen = await render(panel(), { router: false });
  await expect.element(page.getByText("Earlier question?")).toBeVisible();
  await expect.element(page.getByText("Live question?")).toBeVisible();
  expect(snapshot.mock.calls.map(([, root]) => root)).toEqual([LIVE, OLD]);
  const earlier = document.querySelector('[data-interaction="old-1"]')!;
  const live = document.querySelector('[data-interaction="live-1"]')!;
  expect(earlier.textContent).toContain("From an earlier session of this thread");
  expect(live.textContent).not.toContain("earlier session");
});

it("an earlier session that cannot be read is said, and no list that leaves its requests out is shown", async () => {
  transportOver({ oldReadFails: true });
  await using _screen = await render(panel(), { router: false });
  await expect
    .element(page.getByText(/an earlier session of this thread could not be read/))
    .toBeVisible();
  expect(document.querySelector('[data-interaction="live-1"]')).toBeNull();
});
