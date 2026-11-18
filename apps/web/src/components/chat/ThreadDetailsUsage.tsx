import type {
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  collectProviderUsageLimits,
  formatDuration,
  type LimitPace,
  limitsNotice,
  paceOf,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import type { ReactNode } from "react";

import { useSuppliedRead } from "../../aetheria/control/jobs/useSuppliedRead";
import { parseUsage, readingView } from "../../aetheria/control/usage/model";
import { useUsageTransport } from "../../aetheria/control/usage/transport";
import { usePrimarySettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatContextWindowCompactionMessage } from "./ContextWindowMeter.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

const PACE_LABEL: Record<LimitPace, string> = {
  ahead: "Ahead of pace",
  on: "On pace",
  under: "Under pace",
};

export interface ThreadDetailsUsageInput {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly contextWindow: ContextWindowSnapshot | null;
}

type UsageTone = "error" | "warning" | null;

/** The selected provider's limit windows. Each row reads as room left. */
export function ThreadDetailsUsage({
  providerInstanceId,
  providers,
  sources,
}: Omit<ThreadDetailsUsageInput, "contextWindow">) {
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const report =
    providerInstanceId !== null
      ? collectProviderUsageLimits(providerInstanceId, providers, sources, now)
      : null;
  // Only this instance's data: the report keeps one instance per login, and any other entry may be
  // a different login or workspace, so fall back to the instance's own snapshot.
  const limits =
    report?.accounts.find((entry) => entry.instanceId === providerInstanceId)?.limits ??
    providers.find((provider) => provider.instanceId === providerInstanceId)?.usageLimits;
  if (!limits) return null;
  const notice = limitsNotice(limits);

  return (
    <ThreadDetailsSection
      headingId="thread-details-usage-heading"
      title="Usage limits"
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        {notice ? (
          <UsageRow
            label="Limits"
            fill={null}
            tone={null}
            value="Unavailable"
            tooltip={<span className="text-foreground">{notice}</span>}
          />
        ) : (
          limits.windows.map((window) => <LimitRow key={window.id} window={window} now={now} />)
        )}
      </div>
    </ThreadDetailsSection>
  );
}

const WEEKLY_QUOTA = { id: "seven-day", label: "7d" };
const SUBSCRIPTIONS = [
  {
    id: "anthropic",
    label: "Claude",
    windows: [WEEKLY_QUOTA, { id: "provider:weekly-fable", label: "Fable 7d" }],
  },
  { id: "openai-codex", label: "Codex", windows: [WEEKLY_QUOTA] },
] as const;

export function ThreadDetailsSubscriptionUsage({
  environmentId,
}: {
  readonly environmentId: string;
}) {
  const transport = useUsageTransport();
  const { view, refreshing, refresh } = useSuppliedRead({
    environmentId,
    resetKey: environmentId,
    read: () => transport.read({ environmentId }),
    parse: parseUsage,
  });
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  return (
    <ThreadDetailsSection
      headingId="thread-details-subscription-heading"
      title="Subscription usage"
      separated={false}
      actions={
        <Button size="xs" variant="ghost" disabled={refreshing} onClick={() => void refresh()}>
          Refresh<span className="sr-only"> subscription usage</span>
        </Button>
      }
    >
      <div className="grid grid-cols-[minmax(0,max-content)_minmax(1rem,1fr)_auto] gap-x-3 text-xs">
        {SUBSCRIPTIONS.map((provider) => {
          const reading =
            view.tag === "read"
              ? view.value.readings.find((entry) => entry.provider === provider.id)
              : undefined;
          if (!reading) return null;
          const windows = provider.windows.flatMap(({ id, label }) => {
            const window = reading.windows.find((entry) => entry.id === id);
            if (typeof window?.usedPercent !== "number") return [];
            const resetTime = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
            if (resetTime <= now) return [];
            return [{ id, label, used: window.usedPercent, resetsAt: window.resetsAt, resetTime }];
          });
          if (windows.length === 0) return null;
          const note = readingView(reading).note;
          return (
            <Tooltip key={provider.id}>
              <TooltipTrigger
                render={
                  <div
                    role="group"
                    aria-label={`${provider.label} usage`}
                    tabIndex={0}
                    className="col-span-3 grid cursor-default grid-cols-subgrid items-center gap-y-1.5 rounded-lg px-2.5 py-1.5 outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-foreground/5"
                  />
                }
              >
                <div className="col-span-3 flex items-center justify-between gap-2 font-medium">
                  <span>{provider.label}</span>
                  {reading.status === "stale" ? (
                    <span className="text-muted-foreground">Stale</span>
                  ) : null}
                </div>
                {windows.map(({ id, label, used }) => (
                  <div key={id} className="col-span-3 grid grid-cols-subgrid items-center">
                    <span className="text-muted-foreground">{label}</span>
                    <span
                      aria-hidden
                      className="h-[3px] overflow-hidden rounded-full bg-muted-foreground/30"
                    >
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          used >= 90 ? "bg-error" : used >= 80 ? "bg-warning" : "bg-foreground/80",
                        )}
                        style={{ width: `${Math.min(100, used)}%` }}
                      />
                    </span>
                    <span className="text-end tabular-nums">
                      {used}%<span className="sr-only"> used</span>
                    </span>
                  </div>
                ))}
              </TooltipTrigger>
              <TooltipPopup side="left" sideOffset={16}>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{provider.label} usage</span>
                  <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-muted-foreground">
                    {windows.map(({ id, label, resetsAt, resetTime }) => (
                      <div key={id} className="col-span-3 grid grid-cols-subgrid">
                        <span>{label}:</span>
                        {resetsAt && resetTime > now ? (
                          <>
                            <span className="tabular-nums">
                              Resets in {formatDuration(resetTime - now)}
                            </span>
                            <span className="tabular-nums">
                              <span aria-hidden>· </span>
                              <time dateTime={resetsAt}>
                                {formatUpcomingTimestamp(resetsAt, timestampFormat, now)}
                              </time>
                            </span>
                          </>
                        ) : (
                          <span className="col-span-2">Reset time not reported</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {reading.label === "fixture" ? <span>Fixture data</span> : null}
                  {note ? <span>{note}</span> : null}
                </div>
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </ThreadDetailsSection>
  );
}

/** The thread's context window. The bar fills as context is used; the tick marks auto-compaction. */
export function ThreadDetailsContext({ usage }: { readonly usage: ContextWindowSnapshot }) {
  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const used =
    maxTokens !== null && usage.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  const threshold = usage.autoCompactThreshold ?? null;
  const tick =
    maxTokens !== null && threshold !== null && threshold > 0 && threshold < maxTokens
      ? (threshold / maxTokens) * 100
      : null;
  const usedTokens = formatContextWindowTokens(usage.usedTokens);
  return (
    <ThreadDetailsSection
      headingId="thread-details-context-heading"
      title="Context window"
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        <UsageRow
          label="Context"
          fill={used}
          tone={used === null ? null : used >= 90 ? "error" : used >= 80 ? "warning" : null}
          tick={tick}
          muted
          value={
            maxTokens !== null
              ? `${usedTokens} / ${formatContextWindowTokens(maxTokens)}`
              : usedTokens
          }
          ariaValue={used !== null ? `${used}% used` : `${usedTokens} tokens used`}
          tooltip={
            <>
              <span className="text-foreground">
                {used !== null ? `Context: ${used}% used` : `Context: ${usedTokens} tokens used`}
              </span>
              {maxTokens !== null ? (
                <span className="text-muted-foreground">
                  {usage.usedTokens.toLocaleString("en-US")} of {maxTokens.toLocaleString("en-US")}{" "}
                  tokens
                </span>
              ) : null}
              {threshold !== null && threshold > 0 ? (
                <span className="text-muted-foreground">
                  {formatContextWindowCompactionMessage(null, threshold)}
                </span>
              ) : null}
            </>
          }
        />
      </div>
    </ThreadDetailsSection>
  );
}

function LimitRow({
  window,
  now,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const left = remainingPercent(window);
  const pace = paceOf(window, now);
  const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  return (
    <UsageRow
      label={window.label}
      fill={left}
      tone={left <= 10 ? "error" : left <= 20 ? "warning" : null}
      value={`${left}%`}
      ariaValue={`${left}% left`}
      tooltip={
        <>
          <span className="text-foreground">
            {window.label}: {left}% left
          </span>
          {window.resetsAt && resetsAt > now ? (
            <span className="text-muted-foreground">
              Resets in {formatDuration(resetsAt - now)} ·{" "}
              {formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)}
            </span>
          ) : null}
          {pace ? <span className="text-muted-foreground">{PACE_LABEL[pace]}</span> : null}
        </>
      }
    />
  );
}

/** One label, hairline, and value row; the whole row opens the details tooltip. */
function UsageRow({
  label,
  fill,
  tone,
  tick = null,
  value,
  ariaValue = value,
  tooltip,
  muted = false,
}: {
  readonly label: string;
  /** Bar fill from 0 to 100. Null hides the bar. */
  readonly fill: number | null;
  readonly tone: UsageTone;
  /** A marker on the bar, from 0 to 100. */
  readonly tick?: number | null;
  readonly value: string;
  readonly ariaValue?: string;
  readonly tooltip: ReactNode;
  readonly muted?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            aria-label={`${label}: ${ariaValue}`}
            className="col-span-3 grid h-6 cursor-default grid-cols-subgrid items-center rounded-lg px-2.5 outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08]"
          />
        }
      >
        <span className="max-w-28 truncate text-muted-foreground">{label}</span>
        {fill !== null ? (
          <span className="relative h-[3px] rounded-full bg-muted-foreground/30 dark:bg-muted-foreground/20">
            {fill > 0 ? (
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  tone === "error"
                    ? "bg-error"
                    : tone === "warning"
                      ? "bg-warning"
                      : muted
                        ? "bg-muted-foreground"
                        : "bg-foreground/80",
                )}
                style={{ width: `max(${fill}%, 6px)` }}
              />
            ) : null}
            {tick !== null ? (
              <span
                aria-hidden
                className="absolute -top-[3px] h-[9px] w-px -translate-x-1/2 bg-foreground/60"
                style={{ left: `${tick}%` }}
              />
            ) : null}
          </span>
        ) : null}
        <span
          className={cn(
            // Text-only rows span the bar column so they never widen the shared value column.
            "text-end font-medium tabular-nums",
            fill === null && "col-span-2",
            tone === "error"
              ? "text-error-foreground"
              : tone === "warning"
                ? "text-warning-foreground"
                : fill === null
                  ? "text-muted-foreground"
                  : "text-foreground/80",
          )}
        >
          {value}
        </span>
      </TooltipTrigger>
      {/* Rows sit 8px inside the card; clear its edge instead of overlapping it. */}
      <TooltipPopup side="left" sideOffset={16}>
        <div className="flex flex-col gap-0.5">{tooltip}</div>
      </TooltipPopup>
    </Tooltip>
  );
}
