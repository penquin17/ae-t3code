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

const scope = (path: string, kind = "folder") => ({ path, kind });
const scopeOf = (writeScope: unknown) => ({ childSessionId: "kid-a", writeScope });
const manyScope = (count: number) =>
  Array.from({ length: count }, (_, index) => scope(`d${String(index).padStart(3, "0")}`));

export const boardShellVectors: Readonly<Record<string, BoardShellVectorSet>> = {
  // v1p2 step 3: the arguments of the in-process `scope.record` (boardOperations.ts), decoded by the fork's strict schema and by the outer
  // awareness package's `recordScope`. Shape only: what both sides decide alone. The workspace root, a path outside the workspace after
  // normalising and a scope outside the caller's own need the board, so they are tested there.
  recordScopeArgs: {
    accept: [
      { name: "one folder", value: scopeOf([scope("src/a")]) },
      { name: "one file", value: scopeOf([scope("src/a.ts", "file")]) },
      {
        name: "a folder and a file",
        value: scopeOf([scope("src/a"), scope("docs/one.md", "file")]),
      },
      {
        name: "a trailing slash and a dot-slash",
        value: scopeOf([scope("src/a/"), scope("./lib")]),
      },
      { name: "exactly 64 entries", value: scopeOf(manyScope(64)) },
    ],
    refuse: [
      { name: "caller field smuggled in", value: { ...scopeOf([scope("src")]), sessionId: "me" } },
      {
        name: "a root field smuggled in",
        value: { ...scopeOf([scope("src")]), rootSessionId: "me" },
      },
      { name: "childSessionId missing", value: { writeScope: [scope("src")] } },
      {
        name: "an empty childSessionId",
        value: { childSessionId: "", writeScope: [scope("src")] },
      },
      { name: "writeScope missing", value: { childSessionId: "kid-a" } },
      { name: "an empty scope", value: scopeOf([]) },
      { name: "65 entries", value: scopeOf(manyScope(65)) },
      { name: "a scope that is not a list", value: scopeOf("src") },
      { name: "an entry that is not an object", value: scopeOf(["src"]) },
      { name: "an entry without a kind", value: scopeOf([{ path: "src" }]) },
      { name: "an unknown kind", value: scopeOf([scope("src", "dir")]) },
      {
        name: "an entry with an extra field",
        value: scopeOf([{ path: "src", kind: "file", owner: "x" }]),
      },
      { name: "an empty path", value: scopeOf([scope("")]) },
      { name: "a path that is not a string", value: scopeOf([{ path: 1, kind: "file" }]) },
      { name: "an absolute path", value: scopeOf([scope("/w/src")]) },
      { name: "a backslash-rooted path", value: scopeOf([scope("\\src")]) },
      { name: "a parent step", value: scopeOf([scope("../elsewhere")]) },
      { name: "a parent step inside a path", value: scopeOf([scope("src/../../x")]) },
      { name: "not an object", value: [scope("src")] },
    ],
  },

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
