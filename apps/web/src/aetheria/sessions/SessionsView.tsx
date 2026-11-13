import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useState } from "react";

import { Input } from "../../components/ui/input";
import type { RunResult } from "../core/outcome";
import type { GroupsHandle } from "../groups/useGroups";
import { RefusalNotice } from "../refusals/RefusalNotice";
import { AetheriaSessionTree } from "./AetheriaSessionTree";
import { outcomeText, refusalOf, type OutcomeNotice } from "./outcomeText";
import type { SessionActions } from "./useSessionActions";
import type { TreeModel } from "./types";

/** A quiet line about the saved groups when they are not shown: never an empty success. */
function groupsStatusText(groups: GroupsHandle["state"]): string | undefined {
  const { record, problem } = groups;
  if (record.state === "unavailable") return `Groups unavailable: ${record.reason}`;
  if (record.state === "unknown") return `Groups not read yet: ${record.reason}`;
  return problem === undefined
    ? undefined
    : `Groups shown as last confirmed; the latest read failed: ${problem.message}`;
}

interface Shown {
  readonly notice: OutcomeNotice;
  readonly refusal: ReturnType<typeof refusalOf>;
}

/**
 * Search, the project tree and a polite status line for the last action's outcome, over the supplied
 * model, actions and groups. It holds only view memory (the last notice) and reads no T3 state, so it
 * can be drawn from supplied values; SessionsPanel supplies the real ones.
 */
export function SessionsView(props: {
  readonly model: TreeModel;
  readonly now: number;
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly actions: SessionActions;
  readonly groups: GroupsHandle;
}) {
  const { actions, groups } = props;
  const [shown, setShown] = useState<Shown | null>(null);

  const onResult = (label: string, run: Promise<RunResult<unknown>>) => {
    setShown(null);
    void run.then((result) => {
      // A reply for an action a newer one has replaced says nothing about the present.
      if (!result.current) return;
      setShown({ notice: outcomeText(label, result.outcome), refusal: refusalOf(result.outcome) });
      const outcome = result.outcome;
      if (label === "Fork" && outcome.kind === "confirmed") {
        const target = outcome.value as Parameters<typeof scopedThreadKey>[0];
        actions.open(scopedThreadKey(target));
      }
      if (label === "Fork as" && outcome.kind === "confirmed") {
        const [target] = outcome.value as [Parameters<typeof scopedThreadKey>[0]];
        actions.open(scopedThreadKey(target));
      }
    });
  };

  const groupsStatus = groupsStatusText(groups.state);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-1">
        <Input
          type="search"
          aria-label="Search sessions by title"
          placeholder="Search sessions"
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
        />
      </div>
      <div role="status" aria-live="polite" className="px-3 text-xs text-sidebar-muted-foreground">
        {shown === null || shown.refusal !== undefined ? null : (
          <p
            data-tone={shown.notice.tone}
            className={shown.notice.tone === "error" ? "text-destructive" : undefined}
          >
            {shown.notice.text}
          </p>
        )}
        {groupsStatus === undefined ? null : <p data-groups-status="">{groupsStatus}</p>}
      </div>
      {shown?.refusal === undefined ? null : (
        <div className="px-2 py-1" data-refusal-slot="">
          <RefusalNotice code={shown.refusal.code} backendMessage={shown.refusal.message} />
        </div>
      )}
      <AetheriaSessionTree
        model={props.model}
        now={props.now}
        actions={actions}
        groups={groups}
        onResult={onResult}
      />
    </div>
  );
}
