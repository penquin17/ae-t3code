// The plan-mode switch (C7): the Backend's mode and revision, and one intent, `planMode.set`, which carries the revision the person saw. A conflict (the mode changed meanwhile) is shown with the
// Backend's words and the card re-reads; nothing is flipped before the Backend confirms.
import { useId, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import type { ActionReport, ControlActions } from "./actions";
import { Heading, ReportView, cardClass, mutedClass } from "./parts";
import type { ReadView } from "./reads";
import type { PlanMode } from "./types";

export interface PlanModeCardProps {
  readonly sessionId: string;
  readonly view: ReadView<PlanMode>;
  readonly actions: ControlActions;
  /** Re-reads the mode: called after every action that may have changed it. */
  readonly onRefresh: () => Promise<void>;
}

export function PlanModeCard({ sessionId, view, actions, onRefresh }: PlanModeCardProps) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const [report, setReport] = useState<ActionReport<unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const setMode = async (mode: PlanMode) => {
    const result = await actions.planModeSet({
      sessionId,
      active: !mode.active,
      expectedModeRevision: mode.modeRevision,
    });
    // A conflict or an unknown reply leaves the shown mode unproven: re-read it (a confirmed set was already read back).
    if (
      result.sent &&
      result.reply.reread &&
      !(result.outcome.kind === "confirmed" && result.outcome.refreshed)
    ) {
      await onRefresh();
    }
    if (result.sent && result.current) setReport(result);
  };

  const toggle = async (mode: PlanMode) => {
    setBusy(true);
    // `.finally` rather than try/finally: React Compiler cannot compile a `try` without a `catch`.
    await setMode(mode).finally(() => {
      setBusy(false);
      sectionRef.current?.focus();
    });
  };

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby={headingId}
      data-aetheria="plan-mode-card"
      data-card="plan-mode"
      aria-busy={busy}
      className={`${cardClass} outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
    >
      <Heading id={headingId}>Plan mode</Heading>
      {view.state === "known" ? (
        <>
          <p data-plan-mode={view.value.active ? "on" : "off"} className="text-sm">
            Plan mode is <strong>{view.value.active ? "on" : "off"}</strong> · revision{" "}
            {view.value.modeRevision}
          </p>
          {view.stale ? (
            <p className={mutedClass}>Last read is out of date ({view.reason}).</p>
          ) : null}
          <div>
            <Button variant="outline" disabled={busy} onClick={() => void toggle(view.value)}>
              {view.value.active ? "Turn plan mode off" : "Turn plan mode on"}
            </Button>
          </div>
        </>
      ) : (
        <p data-plan-mode="unknown" className="text-sm">
          {view.state === "unknown" ? "Plan mode is not known yet" : "Plan mode is unavailable"} (
          {view.reason}).
        </p>
      )}
      <ReportView label="Plan mode" report={report} />
    </section>
  );
}
