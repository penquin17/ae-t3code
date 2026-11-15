// AETHERIA M07 Plan step 17 (DV10) — the types of the pinned `@aetheria/goals/tools` entry. The archive's `./tools` export ships no declaration file (its tsdown pure build has `dts: false` and the export names no
// `types`), so the fork declares the part it uses here, copied from packages/aetheria-goals/src/tools/index.ts. Remove this file when the archive is repacked with declarations for `./tools`.
declare module "@aetheria/goals/tools" {
  type Decoded<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly reason: string };

  export const GOAL_OPERATIONS: {
    readonly get: "goals.get";
    readonly create: "goals.create";
    readonly update: "goals.update";
  };

  export interface CreateGoalArgs {
    readonly objective: string;
    readonly max_goal_rounds?: number;
  }
  export interface UpdateGoalArgs {
    readonly goal_id: string;
    readonly revision: number;
    readonly action: "edit" | "pause" | "resume" | "complete" | "blocked";
    readonly objective?: string;
    readonly max_goal_rounds?: number;
    readonly blocked_reason?: string;
  }
  export interface ToolGoal {
    readonly id: string;
    readonly revision: number;
    readonly objective: string;
    readonly phase: "active" | "paused" | "blocked" | "complete";
    readonly roundsStarted: number;
    readonly maxGoalRounds: number;
    readonly blockedReason?: string;
  }
  export type GoalActivation = "armed" | "disarmed" | "unknown";
  export type GoalToolReply =
    | {
        readonly outcome: "ok";
        readonly goal: ToolGoal | null;
        readonly activation?: GoalActivation;
        readonly wrapUp?: true;
      }
    | { readonly outcome: "refused"; readonly code: string; readonly detail?: string }
    | { readonly outcome: "awaiting-human"; readonly proposalId: string }
    | { readonly outcome: "unavailable"; readonly detail: string };

  export const decodeGetGoalArgs: (input: unknown) => Decoded<Record<string, never>>;
  export const decodeCreateGoalArgs: (input: unknown) => Decoded<CreateGoalArgs>;
  export const decodeUpdateGoalArgs: (input: unknown) => Decoded<UpdateGoalArgs>;
  export const decodeGoalToolReply: (input: unknown) => Decoded<GoalToolReply>;
}
