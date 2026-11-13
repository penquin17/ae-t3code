import { describe, expect, it } from "vite-plus/test";

import { controlRouteParams } from "./controlLink";

describe("controlRouteParams", () => {
  it("reads the environment and the thread out of a T3 session id", () => {
    expect(controlRouteParams("env-1:thread-a")).toEqual({
      environmentId: "env-1",
      threadId: "thread-a",
    });
  });

  it("splits at the first colon only, so the thread id keeps the rest", () => {
    expect(controlRouteParams("env-1:thread:a")).toEqual({
      environmentId: "env-1",
      threadId: "thread:a",
    });
  });

  it("returns nothing for an id that is not a T3 thread, so no link is drawn", () => {
    expect(controlRouteParams("a")).toBeNull();
    expect(controlRouteParams(":thread")).toBeNull();
    expect(controlRouteParams("env:")).toBeNull();
  });
});
