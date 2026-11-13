// The region report's reply reaches the connection (M10 review 1, follow-up 1): a `REGIONS_DEVICE_REVOKED` reply is a revoked device and must end access wherever the call was made, so it is reported to the
// connection's banner like every other Aetheria call. Boundary: the production transport (`useT3RegionsTransport`) with T3's command call replaced by a recording function and the primary environment by a
// fixed id; it shows what the transport reports and returns, not the real socket or the banner's own wording (connection/ tests own that).
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { subscribeCallRefusals } from "../connection/callRefusals";
import type { RegionsTransport } from "./sync";

const mocks = vi.hoisted(() => ({ command: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => "env-regions" as EnvironmentId,
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => mocks.command,
}));

import { useT3RegionsTransport } from "./commands";

const PAYLOAD = { clientId: "client-0123456789abcdef", sequence: 1, regions: [] } as never;

/** Collects the refusal codes reported to the connection until disposed. */
function listen() {
  const seen: string[] = [];
  const stop = subscribeCallRefusals((code) => seen.push(code));
  return { seen, [Symbol.dispose]: stop };
}

async function transportFor(reply: unknown) {
  mocks.command = vi.fn(async () => ({ _tag: "Success", value: reply }));
  let transport!: RegionsTransport;
  function Probe() {
    const value = useT3RegionsTransport();
    useEffect(() => {
      transport = value;
    });
    return null;
  }
  const screen = await render(<Probe />, { router: false });
  await vi.waitFor(() => expect(transport).toBeDefined());
  return { transport, screen };
}

it("reports a revoked device's refusal to the connection and still returns the Backend's reply", async () => {
  using heard = listen();
  const { seen } = heard;
  const reply = { ok: false, code: "REGIONS_DEVICE_REVOKED", detail: "revoked" };
  const { transport, screen } = await transportFor(reply);
  await using _screen = screen;
  const got = await act(async () => transport.report(PAYLOAD));
  expect(seen).toEqual(["REGIONS_DEVICE_REVOKED"]);
  expect(got).toEqual(reply);
});

it("an accepted report reports no refusal", async () => {
  using heard = listen();
  const { seen } = heard;
  const { transport, screen } = await transportFor({ ok: true, value: {} });
  await using _screen = screen;
  await act(async () => transport.report(PAYLOAD));
  expect(seen).toEqual([]);
});
