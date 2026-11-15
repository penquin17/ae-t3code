// Mounted once by the shell beside `RegionsSync` (M11 Plan step 21, C6, D9; IP-2): answers the Backend's live inspection requests for this page from the region registry, for as long as it is mounted. It sits outside the
// sidebar, so a closed phone drawer does not stop it. It renders nothing, reads no DOM and calls no action; the only thing it sends is the correlated reply to a request the Backend made. A new session of the
// primary environment is a new connection: the request stream is bound anew and an answer still owed to the old one is dropped. Unmounting releases the stream and the Backend settles what it waited on.
import { useAtomMount, useAtomSubscribe } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useRef } from "react";

import { environmentCatalog } from "~/connection/catalog";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useAtomCommand } from "../../state/use-atom-command";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { aetheriaSendResult } from "../connection/sendResult";
import { REGION_DECLARATIONS } from "../regions/declarations";
import { useRegionRegistry } from "../regions/useRegion";
import { createResponder, type Responder, type ResponderTransport } from "./responder";
import { aetheriaInspect, inspectRequests, setRequestSink } from "./transport";

/** Stand-ins while the primary environment is not known, or a test supplies its own transport: they never change, so they signal and subscribe to nothing. */
const NO_SESSION = Atom.make(0);
const NO_STREAM = Atom.make(0);

export function InspectResponder(props: { readonly transport?: ResponderTransport }) {
  const registry = useRegionRegistry();
  const environmentId = usePrimaryEnvironmentId();
  const sendReply = useAtomCommand(aetheriaInspect.reply, { reportFailure: false });
  const environmentRef = useRef(environmentId);
  const responderRef = useRef<Responder | undefined>(undefined);
  const latest = useRef<ResponderTransport | undefined>(props.transport);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the responder reads the latest environment and transport at each request
  useEffect(() => {
    environmentRef.current = environmentId;
    latest.current = props.transport;
  });
  const replyRef = useRef(sendReply);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the reply command is read at each reply
  useEffect(() => {
    replyRef.current = sendReply;
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds the responder to the page's registry while mounted
  useEffect(() => {
    const real: ResponderTransport = {
      subscribe: (onRequest) => setRequestSink(onRequest),
      reply: async (payload) => {
        const target = environmentRef.current;
        if (target === null) return;
        // A reply that never came is not retried: the Backend ends the query at its own deadline.
        aetheriaSendResult(await replyRef.current({ environmentId: target, input: payload }));
      },
    };
    const responder = createResponder({
      registry,
      declared: REGION_DECLARATIONS,
      transport: {
        subscribe: (onRequest) => (latest.current ?? real).subscribe(onRequest),
        reply: (payload) => (latest.current ?? real).reply(payload),
      },
    });
    responderRef.current = responder;
    responder.start();
    return () => {
      responder.stop();
      responderRef.current = undefined;
    };
  }, [registry]);

  // Keeps this connection's request stream subscribed while mounted (the real transport only).
  useAtomMount<unknown>(
    environmentId === null || props.transport !== undefined
      ? NO_STREAM
      : inspectRequests(environmentId),
  );

  // A new session of the primary environment is a new connection: bind the responder to it.
  const generation =
    environmentId === null ? NO_SESSION : environmentCatalog.sessionGenerationAtom(environmentId);
  useAtomMount(generation);
  useAtomSubscribe(
    generation,
    useStableCallback(() => responderRef.current?.rebind()),
  );
  return null;
}
