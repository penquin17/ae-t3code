// The shared decoding of an Aetheria command result. Boundary: T3's settled command result in, the runner's send result out, with the reply's refusal code reported to the subscribed connection. The results are
// hand-made `Success`/`Failure` values of T3's result type; they show this decoding, not what a live RPC returns.
import { describe, expect, it } from "vite-plus/test";

import { subscribeCallRefusals } from "./callRefusals";
import { aetheriaSendResult } from "./sendResult";

const success = (value: unknown) => ({ _tag: "Success", value }) as never;

function listen() {
  const seen: string[] = [];
  const stop = subscribeCallRefusals((code) => seen.push(code));
  return { seen, stop };
}

describe("aetheriaSendResult", () => {
  it("returns the accepted reply as T3's decoding does, and reports the refusal code in it", () => {
    const { seen, stop } = listen();
    const reply = { ok: false, code: "CHILDREN_DEVICE_REVOKED", detail: "gone" };
    expect(aetheriaSendResult(success(reply))).toEqual({ tag: "accepted", value: reply });
    expect(seen).toEqual(["CHILDREN_DEVICE_REVOKED"]);
    stop();
  });

  it("reports nothing for an accepted success reply", () => {
    const { seen, stop } = listen();
    expect(aetheriaSendResult(success({ ok: true, value: 1 }))).toEqual({
      tag: "accepted",
      value: { ok: true, value: 1 },
    });
    expect(seen).toEqual([]);
    stop();
  });
});
