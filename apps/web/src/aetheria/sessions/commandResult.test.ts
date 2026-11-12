import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { sendResultFromCommand } from "./commandResult";

describe("sendResultFromCommand", () => {
  it("a success is accepted with its value", () => {
    expect(sendResultFromCommand(AsyncResult.success("done"))).toEqual({
      tag: "accepted",
      value: "done",
    });
  });

  it("a failure with a backend message is a refusal carrying that message", () => {
    const result = AsyncResult.failure(Cause.fail(new Error("Thread is running")));
    expect(sendResultFromCommand(result)).toEqual({
      tag: "refused",
      code: "COMMAND_FAILED",
      message: "Thread is running",
    });
  });

  it("a transport failure means the reply may have been lost: not a refusal", () => {
    const result = AsyncResult.failure(Cause.fail(new Error("Socket is not connected")));
    expect(sendResultFromCommand(result)).toEqual({ tag: "lost" });
  });

  it("an interrupted command may have reached the backend: lost", () => {
    const result = AsyncResult.failure(Cause.interrupt());
    expect(sendResultFromCommand(result)).toEqual({ tag: "lost" });
  });

  it("a failure with no readable message still refuses, with a stated fallback", () => {
    const result = AsyncResult.failure(Cause.fail({ weird: true }));
    const sent = sendResultFromCommand(result);
    expect(sent.tag).toBe("refused");
    expect(sent.tag === "refused" && sent.message).toBe("The action failed.");
  });
});
