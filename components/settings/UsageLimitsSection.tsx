import React, { useCallback, useEffect, useState } from 'react';
import {
  buildAIUsageView,
  type AICostRow,
  type AIUsageSnapshot,
  type AIUsageView,
} from '@lantern/shared/ai';
import { aiUsageCounterCopy } from '@lantern/shared/utils/aiUsage';
import { fetchAIUsageDetail, getLatestAIUsage } from '../../services/ai';

/**
 * Usage & limits — the web half of the AI allowance screen.
 *
 * The rule it exists to keep (spec v1, "what not to import" §3): limits are
 * visible, every button says its price, and there is a clear next step at
 * zero. Every number and every line of the price list comes from
 * `@lantern/shared/ai`, the same pure module the mobile screen renders, so the
 * two platforms cannot disagree about what an action costs.
 */

/** How often the countdown re-renders while the panel is open. */
const TICK_MS = 30_000;

function UsageBar({ view }: { view: AIUsageView }) {
  const width = `${Math.round(view.ratio * 100)}%`;
  return (
    <div
      className="w-full h-2.5 rounded-full bg-lantern-background-secondary dark:bg-lantern-surface-secondary overflow-hidden"
      aria-hidden="true"
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${
          view.exhausted ? 'bg-lantern-error' : 'bg-lantern-feature-ai-ink'
        }`}
        style={{ width }}
      />
    </div>
  );
}

function CostRow({ row, figuresKnown }: { row: AICostRow; figuresKnown: boolean }) {
  // "Not affordable" is a claim about a balance. Before the server has told this
  // browser what the balance is, `remaining` is the honest unknown (0), which
  // makes every price read as unaffordable — the whole list in the error colour,
  // asserting a shortfall nobody measured. So the warning colour is spent only
  // when there are real figures behind it.
  const unaffordable = figuresKnown && !row.affordable;
  return (
    <li className="flex items-start justify-between gap-4 py-2.5 border-t border-lantern-border first:border-t-0">
      <div className="min-w-0">
        <p className="text-body text-lantern-text">{row.label}</p>
        <p className="text-caption text-lantern-text-secondary">{row.detail}</p>
        {row.featureCapLabel && (
          <p
            className={`text-label tracking-normal mt-0.5 ${
              row.featureCapReached ? 'text-lantern-error' : 'text-lantern-text-secondary'
            }`}
          >
            {row.featureCapReached
              ? `Its own daily cap is spent — ${row.featureCapLabel}`
              : `Its own daily cap: ${row.featureCapLabel}`}
          </p>
        )}
      </div>
      {/* The price, always, through the one helper every button uses. */}
      <span
        className={`text-caption font-semibold whitespace-nowrap ${
          unaffordable ? 'text-lantern-error' : 'text-lantern-feature-ai-ink'
        }`}
      >
        {row.costLabel}
      </span>
    </li>
  );
}

export interface UsageLimitsSectionProps {
  /**
   * Opens the invite screen. Optional: without it the referral step is still
   * shown (the reward is real either way), just not tappable — better than
   * hiding the one thing that can change the number.
   */
  onInviteFriends?: () => void;
}

export const UsageLimitsSection: React.FC<UsageLimitsSectionProps> = ({ onInviteFriends }) => {
  const [snapshot, setSnapshot] = useState<AIUsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Also republishes the global counts to every subscriber, so opening
      // this panel re-syncs the sidebar badge with the server.
      setSnapshot(await fetchAIUsageDetail());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const fallback = getLatestAIUsage();
  const view = buildAIUsageView(
    snapshot ?? { used: fallback.used, limit: fallback.limit, resetsAt: fallback.resetsAt },
    { nowMs }
  );

  /*
   * What the counter is allowed to say.
   *
   * The badge's figures start at the honest unknown (limit 0) until the server
   * answers, and `buildAIUsageView` reads a 0 as "AI uses are not available on
   * this account" — true of a server that answered zero, a lie about a browser
   * that has not been told yet. This planner tells the two apart via
   * `serverAnswered`, so a cold start with a dead network says it is checking
   * (or that it could not check), never that the student's AI was taken away,
   * and never a number nobody sent. The offline note follows the same split:
   * "the last figures this browser saw" is only honest when there ARE figures.
   */
  const serverAnswered = snapshot !== null;
  const counter = aiUsageCounterCopy({
    knownLabel: view.countLabel,
    limit: view.limit,
    serverAnswered,
    loading,
    failed,
  });
  /** The same split the counter copy uses, for the price list's colours. */
  const figuresKnown = serverAnswered || view.limit > 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-heading font-semibold text-lantern-text">Usage &amp; limits</h3>
        <p className="text-caption text-lantern-text-secondary">
          What you have left today, what each action costs, and what still works at zero.
        </p>
      </div>

      <section className="rounded-lg border border-lantern-border p-4">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <p className="text-heading font-semibold text-lantern-text">{counter.countLine}</p>
          {/* Referral rewards, only when the server actually reported a
              balance. An absent field prints nothing — a "+0" would be a
              number this screen never measured. */}
          {view.bonusLabel && (
            <span className="text-caption font-semibold text-lantern-feature-ai-ink whitespace-nowrap">
              {view.bonusLabel}
            </span>
          )}
          {loading && <span className="text-label tracking-normal text-lantern-text-secondary">Checking…</span>}
        </div>
        <UsageBar view={view} />
        <p className="text-caption text-lantern-text-secondary mt-2">
          {view.resetRelative}
          {view.resetAbsolute ? ` · ${view.resetAbsolute}` : ''}
        </p>
        {counter.offlineNote && (
          <p className="text-caption text-lantern-warning mt-2">{counter.offlineNote}</p>
        )}
      </section>

      {view.exhausted && (
        <section className="rounded-lg bg-lantern-feature-ai-tint p-4">
          <h4 className="text-body font-semibold text-lantern-text">You are out for today</h4>
          <p className="text-caption text-lantern-text-secondary">
            Nothing you have made is locked. Here is what still works.
          </p>
          <ul className="mt-3 space-y-2">
            {view.nextSteps.map((step) =>
              // The referral step is the only one that can change the number,
              // so it is the only one that goes anywhere. There is no purchase
              // here and there never will be.
              step.kind === 'referral' && onInviteFriends ? (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={onInviteFriends}
                    className="text-left w-full rounded-md px-2 py-1 -mx-2 hover:bg-lantern-surface-secondary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-lantern-feature-ai-ink"
                  >
                    <p className="text-body font-semibold text-lantern-text">{step.label}</p>
                    <p className="text-caption text-lantern-text-secondary">{step.detail}</p>
                  </button>
                </li>
              ) : (
                <li key={step.id}>
                  <p className="text-body text-lantern-text">{step.label}</p>
                  <p className="text-caption text-lantern-text-secondary">{step.detail}</p>
                </li>
              )
            )}
          </ul>
        </section>
      )}

      <section>
        <h4 className="text-label tracking-normal uppercase text-lantern-text-secondary mb-1">
          What each action costs
        </h4>
        <ul>
          {view.costRows.map((row) => (
            <CostRow key={row.id} row={row} figuresKnown={figuresKnown} />
          ))}
        </ul>
      </section>

      <section>
        <h4 className="text-label tracking-normal uppercase text-lantern-text-secondary mb-1">
          What costs nothing
        </h4>
        <ul>
          {view.freeRows.map((row) => (
            <li key={row.id} className="py-2.5 border-t border-lantern-border first:border-t-0">
              <p className="text-body text-lantern-text">{row.label}</p>
              <p className="text-caption text-lantern-text-secondary">{row.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-caption text-lantern-text-secondary">
        A run that fails before the AI answers is refunded automatically; one that fails while
        saving keeps its charge, and saving it again is free. Your allowance is the same for
        everyone and resets every day — there is nothing to buy here.
      </p>
    </div>
  );
};

export default UsageLimitsSection;
