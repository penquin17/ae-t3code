// AETHERIA — the result of the read-only XC-6 operation `identity.lifecycle`: for each bound Pi session, does it exist, is it closed, was a prompt accepted.
// Each fact is true, false or null (unknown); the Agent host treats an unlisted session as all-null.
// The shape has no field for a path, a thread id, a message or a token.
import * as Schema from "effect/Schema";

export const IDENTITY_LIFECYCLE_OPERATION = "identity.lifecycle";

const TriState = Schema.NullOr(Schema.Boolean);

export const IdentityLifecycleFacts = Schema.Struct({
  exists: TriState,
  closed: TriState,
  acceptedPrompt: TriState,
});
export type IdentityLifecycleFacts = typeof IdentityLifecycleFacts.Type;

export const IdentityLifecycleResult = Schema.Struct({
  sessions: Schema.Record(Schema.String, IdentityLifecycleFacts),
});
export type IdentityLifecycleResult = typeof IdentityLifecycleResult.Type;
