// Every code the deliverables contracts can carry has a plain line (M10 Plan step 16, D14). The tables are READ from `@t3tools/aetheria-contracts`, never transcribed: a code added there fails
// this test until it has words. These codes are not in the canonical refusals table (`refusals/`, another folder's), so this folder owns their lines; the Backend's own message is always shown
// beside the line, verbatim.
import {
  DELIVERABLE_DOWNLOAD_REFUSAL_STATUS,
  DELIVERABLE_SNAPSHOT_FAILURE_CODES,
  DELIVERABLES_CLIENT_CODE_CLASSES,
} from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CLIENT_CODE_LINES,
  DOWNLOAD_CODE_LINES,
  lineForCode,
  SNAPSHOT_FAILURE_LINES,
} from "./words";

describe("the lines cover the contracts' tables exactly", () => {
  it("client read codes", () => {
    expect(Object.keys(CLIENT_CODE_LINES).toSorted()).toEqual(
      Object.keys(DELIVERABLES_CLIENT_CODE_CLASSES).toSorted(),
    );
  });
  it("download refusal codes", () => {
    expect(Object.keys(DOWNLOAD_CODE_LINES).toSorted()).toEqual(
      Object.keys(DELIVERABLE_DOWNLOAD_REFUSAL_STATUS).toSorted(),
    );
  });
  it("snapshot failure codes", () => {
    expect(Object.keys(SNAPSHOT_FAILURE_LINES).toSorted()).toEqual(
      [...DELIVERABLE_SNAPSHOT_FAILURE_CODES].toSorted(),
    );
  });
  it("every line is a sentence, and none claims a state change it cannot know", () => {
    const all = [
      ...Object.values(CLIENT_CODE_LINES),
      ...Object.values(DOWNLOAD_CODE_LINES),
      ...Object.values(SNAPSHOT_FAILURE_LINES),
    ];
    for (const line of all) {
      expect(line.length).toBeGreaterThan(10);
      expect(line.trim()).toBe(line);
    }
    expect(all.some((line) => /nothing (was )?changed/i.test(line))).toBe(false);
  });
});

describe("lineForCode", () => {
  it("answers a known code with its line and an unknown code with nothing, so the Backend's words stand alone", () => {
    expect(lineForCode("DOWNLOAD_NOT_FOUND")).toBe(DOWNLOAD_CODE_LINES.DOWNLOAD_NOT_FOUND);
    expect(lineForCode("DELIVERABLES_NOT_AUTHORIZED")).toBe(
      CLIENT_CODE_LINES.DELIVERABLES_NOT_AUTHORIZED,
    );
    expect(lineForCode("SNAPSHOT_CHANGED")).toBe(SNAPSHOT_FAILURE_LINES.SNAPSHOT_CHANGED);
    expect(lineForCode("NEW_CODE")).toBeUndefined();
    expect(lineForCode("constructor")).toBeUndefined();
  });
});
