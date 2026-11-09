// AETHERIA M09 step 17 — shared vectors for the `board.record-shell` request, decoded by the fork's strict schema and by the outer awareness
// package's `recordShell` (tests/awareness/board-shell/vectors.test.mjs reads this file by path). `accept` must decode and be recorded, `refuse`
// must not decode and be refused. Only what both sides decide alone is here: shape, field set, count, uniqueness and absolute paths. Data only,
// no imports; every path is synthetic and sits under /w, the workspace of the outer test.

export interface BoardShellVector {
  readonly name: string;
  readonly value: unknown;
}

export interface BoardShellVectorSet {
  readonly accept: readonly BoardShellVector[];
  readonly refuse: readonly BoardShellVector[];
}

const many = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `/w/f${String(index).padStart(3, "0")}.txt`);

export const boardShellVectors: Readonly<Record<string, BoardShellVectorSet>> = {
  recordShellArgs: {
    accept: [
      { name: "one changed path", value: { paths: ["/w/a.txt"], outcome: "changed" } },
      {
        name: "two changed paths",
        value: { paths: ["/w/a.txt", "/w/src/b.ts"], outcome: "changed" },
      },
      { name: "exactly 100 changed paths", value: { paths: many(100), outcome: "changed" } },
      { name: "unknown with no paths", value: { paths: [], outcome: "unknown" } },
    ],
    refuse: [
      {
        name: "caller field smuggled in",
        value: { paths: ["/w/a.txt"], outcome: "changed", sessionId: "s1" },
      },
      { name: "outcome missing", value: { paths: ["/w/a.txt"] } },
      { name: "paths missing", value: { outcome: "changed" } },
      { name: "unknown outcome word", value: { paths: ["/w/a.txt"], outcome: "gone" } },
      { name: "paths not a list", value: { paths: "/w/a.txt", outcome: "changed" } },
      { name: "a path that is not a string", value: { paths: [1], outcome: "changed" } },
      { name: "an empty path", value: { paths: [""], outcome: "changed" } },
      { name: "a relative path", value: { paths: ["a.txt"], outcome: "changed" } },
      { name: "a repeated path", value: { paths: ["/w/a.txt", "/w/a.txt"], outcome: "changed" } },
      { name: "101 paths", value: { paths: many(101), outcome: "changed" } },
      { name: "changed with no paths", value: { paths: [], outcome: "changed" } },
      { name: "unknown with a path", value: { paths: ["/w/a.txt"], outcome: "unknown" } },
      { name: "not an object", value: ["/w/a.txt"] },
    ],
  },
};
