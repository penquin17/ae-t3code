import { describe, expect, it } from "vite-plus/test";

import { reportCallRefusal, subscribeCallRefusals } from "./callRefusals";

describe("call refusals reach the listeners subscribed now", () => {
  it("delivers a code to each listener, stops after unsubscribe, and drops a report nobody hears", () => {
    const seen: string[] = [];
    reportCallRefusal("BEFORE_DEVICE_REVOKED");
    const stop = subscribeCallRefusals((code) => seen.push(code));
    reportCallRefusal("GROUPS_DEVICE_REVOKED");
    stop();
    reportCallRefusal("AFTER_DEVICE_REVOKED");
    expect(seen).toEqual(["GROUPS_DEVICE_REVOKED"]);
  });
});
