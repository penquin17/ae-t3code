// AETHERIA M05 step 6 (D14): production `projectRootOf` for the thread index. M03's `deriveProject` is async and the index's rule is sync, so the Backend
// precomputes the root of each observed working folder before the index binds it. An unobserved folder, a failed or non-canonical derivation, or no
// absolute checkout gives `null` (lineage stays unverifiable); the working folder is never guessed as the root.
import { deriveProject, nodeFs } from "./identity/backendEntry.ts";

/** The most folders the cache keeps; the oldest observation is forgotten first (a forgotten folder reads `null` until observed again). */
export const PROJECT_ROOT_CACHE_LIMIT = 1024;

export interface ProjectRootCache {
  /** The thread index's synchronous rule. `null` for a folder not observed or whose derivation gave no canonical root. */
  projectRootOf(workingFolder: string): string | null;
  /**
   * Derives (again) and remembers the root of a working folder, then returns it. Observing is the refresh on launch or resume: a derivation that now fails
   * forgets the earlier root rather than keeping a stale one. Never rejects. One derivation is shared by concurrent observers of a folder.
   */
  observe(workingFolder: string): Promise<string | null>;
}

const canonicalRoot = (value: unknown): value is string =>
  typeof value === "string" &&
  value.startsWith("/") &&
  !value.includes("\0") &&
  !value.split("/").includes("..") &&
  (value.length === 1 || !value.endsWith("/"));

export function createProjectRootCache(options: {
  readonly derive: (workingFolder: string) => Promise<string | null>;
}): ProjectRootCache {
  const roots = new Map<string, string>();
  const inflight = new Map<string, Promise<string | null>>();

  const remember = (folder: string, root: string | null): string | null => {
    roots.delete(folder);
    if (root === null) return null;
    roots.set(folder, root);
    if (roots.size > PROJECT_ROOT_CACHE_LIMIT) roots.delete(roots.keys().next().value as string);
    return root;
  };

  const cache: ProjectRootCache = {
    projectRootOf: (folder) => roots.get(folder) ?? null,
    observe(folder) {
      if (typeof folder !== "string" || !folder.startsWith("/")) return Promise.resolve(null);
      const running = inflight.get(folder);
      if (running !== undefined) return running;
      const derivation = (async () => {
        let derived: string | null;
        try {
          const root = await options.derive(folder);
          derived = canonicalRoot(root) ? root : null;
        } catch {
          derived = null;
        }
        return remember(folder, derived);
      })().finally(() => {
        inflight.delete(folder);
      });
      inflight.set(folder, derivation);
      return derivation;
    },
  };
  return Object.freeze(cache);
}

/**
 * The production derivation: M03's `deriveProject` over the real filesystem, relative to the Aetheria checkout (`AETHERIA_CHECKOUT`, which decides home or
 * foreign). Without an absolute checkout nothing is derived.
 */
export function createProductionProjectRootCache(options: {
  readonly checkout: string | undefined;
}): ProjectRootCache {
  const { checkout } = options;
  return createProjectRootCache({
    derive: async (folder) => {
      if (typeof checkout !== "string" || !checkout.startsWith("/")) return null;
      // M03's derivation falls back to the folder itself when nothing resolves; a folder that is not there is unknown here, never a root by guess.
      if ((await nodeFs.lstat(folder)) === undefined) return null;
      const derived = await deriveProject(nodeFs, folder, checkout);
      return derived.ok ? derived.project.root : null;
    },
  });
}
