import type { AnyRouter } from "@tanstack/react-router";
import type { AtomRegistry } from "effect/reactivity";

import { useComposerDraftStore } from "../composerDraftStore";
import { environmentThreadShells } from "../state/threads";
import { resolveActiveThreadRouteRef, resolveThreadRouteTarget } from "../threadRoutes";
import { startTitleSync } from "./titleSync";

/**
 * Keeps the tab title at "Aetheria — Knowledge comes together", or "<thread title> — Aetheria" while a
 * thread is open, from the router and the app's thread-shell data. The one writer of the web title.
 */
export function startAetheriaDocumentTitle(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
): () => void {
  const readOpenThreadTitle = (): string | null => {
    const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
    const draft =
      target?.kind === "draft"
        ? useComposerDraftStore.getState().getDraftSession(target.draftId)
        : null;
    const ref = resolveActiveThreadRouteRef(target, draft);
    if (ref === null) return null;
    const shell = registry
      .get(environmentThreadShells.quietThreadShellsAtom)
      .find((thread) => thread.environmentId === ref.environmentId && thread.id === ref.threadId);
    return shell?.title ?? null;
  };

  return startTitleSync({
    readOpenThreadTitle,
    subscribe: (notify) => {
      const stops = [
        registry.subscribe(environmentThreadShells.quietThreadShellsAtom, notify),
        router.subscribe("onResolved", notify),
        useComposerDraftStore.subscribe(notify),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
    write: (title) => {
      document.title = title;
    },
  });
}
