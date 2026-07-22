import React, { useEffect, useRef } from 'react';
import type { Chart as ChartType, ChartConfiguration } from 'chart.js';
import { AdminAnalytics } from '../../services/admin';
import { Card } from '../ui/Card';
import { Select } from '../ui/Select';
import { StatPill } from '../ui/StatPill';
import { exportCsv } from './types';

interface AdminAnalyticsPanelProps {
  analytics: AdminAnalytics | null;
  periodDays: 7 | 30 | 90;
  onPeriodChange: (days: 7 | 30 | 90) => void;
}

const CHART_COLORS = {
  light: [
    'rgba(79, 70, 229, 0.85)',
    'rgba(13, 148, 136, 0.85)',
    'rgba(225, 29, 72, 0.85)',
    'rgba(245, 158, 11, 0.85)',
    'rgba(14, 165, 233, 0.85)',
    'rgba(192, 38, 211, 0.85)',
  ],
  dark: [
    'rgba(99, 102, 241, 0.85)',
    'rgba(45, 212, 191, 0.85)',
    'rgba(251, 113, 133, 0.85)',
    'rgba(252, 211, 77, 0.85)',
    'rgba(56, 189, 248, 0.85)',
    'rgba(232, 121, 249, 0.85)',
  ],
};

function useChartTheme(): 'light' | 'dark' {
  const [theme, setTheme] = React.useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

interface LineChartProps {
  title: string;
  labels: string[];
  datasets: Array<{ label: string; data: number[] }>;
  theme: 'light' | 'dark';
}

const LineChart: React.FC<LineChartProps> = ({ title, labels, datasets, theme }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartType | null>(null);
  const colors = CHART_COLORS[theme];

  useEffect(() => {
    let active = true;
    const canvas = canvasRef.current;
    if (!canvas || labels.length === 0) return;

    import('chart.js').then(({ Chart, registerables }) => {
      if (!active || !canvasRef.current) return;
      Chart.register(...registerables);
      if (chartRef.current) {
        chartRef.current.destroy();
      }

      const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
      const ticksColor = theme === 'dark' ? '#94a3b8' : '#475569';

      const config: ChartConfiguration<'line'> = {
        type: 'line',
        data: {
          labels,
          datasets: datasets.map((ds, i) => ({
            label: ds.label,
            data: ds.data,
            borderColor: colors[i % colors.length],
            backgroundColor: colors[i % colors.length]?.replace('0.85', '0.15'),
            tension: 0.25,
            fill: false,
            pointRadius: labels.length > 45 ? 0 : 2,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: ticksColor, boxWidth: 12 } },
            title: { display: false },
          },
          scales: {
            x: {
              ticks: { color: ticksColor, maxTicksLimit: 10 },
              grid: { color: gridColor },
            },
            y: {
              ticks: { color: ticksColor, precision: 0 },
              grid: { color: gridColor },
              beginAtZero: true,
            },
          },
        },
      };

      chartRef.current = new Chart(canvasRef.current!, config);
    });

    return () => {
      active = false;
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [labels, datasets, theme, colors]);

  return (
    <Card variant="elevated">
      <h3 className="text-sm font-semibold text-lantern-text mb-3">{title}</h3>
      <div className="h-56">
        <canvas ref={canvasRef} />
      </div>
    </Card>
  );
};

interface SimpleChartProps {
  title: string;
  type: 'doughnut' | 'bar';
  labels: string[];
  data: number[];
  theme: 'light' | 'dark';
}

const SimpleChart: React.FC<SimpleChartProps> = ({ title, type, labels, data, theme }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartType | null>(null);
  const colors = CHART_COLORS[theme];

  useEffect(() => {
    let active = true;
    const canvas = canvasRef.current;
    if (!canvas || labels.length === 0) return;

    import('chart.js').then(({ Chart, registerables }) => {
      if (!active || !canvasRef.current) return;
      Chart.register(...registerables);
      if (chartRef.current) chartRef.current.destroy();

      const ticksColor = theme === 'dark' ? '#94a3b8' : '#475569';
      const config: ChartConfiguration = {
        type,
        data: {
          labels,
          datasets: [
            {
              label: title,
              data,
              backgroundColor: labels.map((_, i) => colors[i % colors.length]),
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: type === 'doughnut' ? 'right' : 'top',
              labels: { color: ticksColor, boxWidth: 12 },
            },
          },
          scales:
            type === 'bar'
              ? {
                  x: { ticks: { color: ticksColor }, grid: { display: false } },
                  y: { ticks: { color: ticksColor, precision: 0 }, beginAtZero: true },
                }
              : undefined,
        },
      };

      chartRef.current = new Chart(canvasRef.current!, config);
    });

    return () => {
      active = false;
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [labels, data, theme, type, title, colors]);

  return (
    <Card variant="elevated">
      <h3 className="text-sm font-semibold text-lantern-text mb-3">{title}</h3>
      <div className={type === 'doughnut' ? 'h-52' : 'h-56'}>
        <canvas ref={canvasRef} />
      </div>
    </Card>
  );
};

const STREAK_ORDER = ['0', '1-3', '4-7', '8-14', '15+'];

export const AdminAnalyticsPanel: React.FC<AdminAnalyticsPanelProps> = ({
  analytics,
  periodDays,
  onPeriodChange,
}) => {
  const theme = useChartTheme();

  if (!analytics) return null;

  const labels = analytics.series.map((row) => row.date.slice(5));
  const messagesTotal = analytics.series.reduce(
    (sum, row) => sum + row.groupMessages + row.dmMessages,
    0
  );

  const onExport = () => {
    exportCsv(
      `admin-analytics-${periodDays}d.csv`,
      analytics.series.map((row) => ({
        date: row.date,
        signups: row.signups,
        activeUsers: row.activeUsers,
        tests: row.tests,
        flashcards: row.flashcards,
        questions: row.questions,
        games: row.games,
        dailyQuizzes: row.dailyQuizzes,
        groupMessages: row.groupMessages,
        dmMessages: row.dmMessages,
        aiEvents: row.aiEvents,
        newListings: row.newListings,
        orders: row.orders,
        gmv: row.gmv ?? 0,
      }))
    );
  };

  const mk = analytics.marketplaceKpis;
  const retention = analytics.retentionCohorts;
  const search = analytics.searchAnalytics;
  const funnel = analytics.acquisitionFunnel;
  const studyFunnel = analytics.studyFunnel;
  const platformEvents = analytics.platformFromEvents;

  const streakLabels = STREAK_ORDER.filter((k) => analytics.streakDistribution[k] != null);
  const streakData = streakLabels.map((k) => analytics.streakDistribution[k] ?? 0);

  const featureLabels = ['Tests', 'Flashcards', 'Questions', 'Games', 'Daily quizzes'];
  const featureData = [
    analytics.featureTotals.tests,
    analytics.featureTotals.flashcards,
    analytics.featureTotals.questions,
    analytics.featureTotals.games,
    analytics.featureTotals.dailyQuizzes,
  ];

  const aiEntries = Object.entries(analytics.aiByFeature).sort(([, a], [, b]) => b - a);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center">
          <label className="text-sm text-lantern-text-muted">Period</label>
          <Select
            value={periodDays}
            onChange={(e) => onPeriodChange(Number(e.target.value) as 7 | 30 | 90)}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </Select>
        </div>
        <button type="button" onClick={onExport} className="text-sm text-lantern-primary hover:underline">
          Export CSV
        </button>
      </div>

      <p className="text-xs text-lantern-text-muted">
        Aggregated from study activity, marketplace orders, and consent-gated first-party product events.
        Push-token platform split is approximate; event-based DAU is preferred when available.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <StatPill label="DAU" value={analytics.kpis.dau} accent="primary" />
        <StatPill label="WAU" value={analytics.kpis.wau} accent="success" />
        <StatPill label="MAU" value={analytics.kpis.mau} accent="success" />
        <StatPill label="Total users" value={analytics.kpis.totalUsers} accent="neutral" />
        <StatPill label="Active groups" value={analytics.kpis.activeGroups} accent="neutral" />
        <StatPill label="Mobile app users" value={analytics.kpis.mobileAppUsers} accent="accent" />
        <StatPill label="Messages (period)" value={messagesTotal} accent="neutral" />
      </div>

      {mk && (
        <Card variant="elevated">
          <h3 className="text-sm font-semibold text-lantern-text mb-3">Marketplace (period)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatPill label="GMV" value={`₦${Number(mk.gmv).toLocaleString()}`} accent="primary" />
            <StatPill label="Completed orders" value={mk.ordersCount} accent="success" />
            <StatPill label="AOV" value={`₦${Number(mk.aov).toLocaleString()}`} accent="neutral" />
            <StatPill label="Dispute rate" value={`${mk.disputedRate}%`} accent="accent" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-lantern-text-muted mb-2">GMV by category</p>
              {(mk.gmvByCategory?.length ?? 0) === 0 ? (
                <p className="text-sm text-lantern-text-muted">No completed sales in period.</p>
              ) : (
                <div className="space-y-1">
                  {mk.gmvByCategory.map((row) => (
                    <div key={row.category} className="flex justify-between text-sm">
                      <span className="text-lantern-text-muted capitalize">{row.category.replace(/_/g, ' ')}</span>
                      <span className="font-medium">₦{Number(row.gmv).toLocaleString()} · {row.orders}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-lantern-text-muted mb-2">GMV by campus</p>
              {(mk.gmvByCampus?.length ?? 0) === 0 ? (
                <p className="text-sm text-lantern-text-muted">No campus-attributed sales yet.</p>
              ) : (
                <div className="space-y-1">
                  {mk.gmvByCampus.map((row) => (
                    <div key={row.campus} className="flex justify-between text-sm">
                      <span className="text-lantern-text-muted">{row.campus}</span>
                      <span className="font-medium">₦{Number(row.gmv).toLocaleString()} · {row.orders}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {(retention || funnel || platformEvents) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {retention && (
            <Card variant="elevated">
              <h3 className="text-sm font-semibold text-lantern-text mb-2">Retention cohorts</h3>
              <p className="text-xs text-lantern-text-muted mb-3">
                Signups 30–60 days ago ({retention.signups}). % with study activity by day.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <StatPill label="D1" value={`${retention.d1}%`} accent="primary" />
                <StatPill label="D7" value={`${retention.d7}%`} accent="success" />
                <StatPill label="D30" value={`${retention.d30}%`} accent="accent" />
              </div>
            </Card>
          )}
          {funnel && (
            <Card variant="elevated">
              <h3 className="text-sm font-semibold text-lantern-text mb-3">Acquisition funnel</h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-lantern-text-muted">Guest listing views</span><span className="font-medium">{funnel.guestListingViews}</span></div>
                <div className="flex justify-between"><span className="text-lantern-text-muted">Signup started</span><span className="font-medium">{funnel.signupStarted}</span></div>
                <div className="flex justify-between"><span className="text-lantern-text-muted">Signups completed</span><span className="font-medium">{funnel.signupsCompleted}</span></div>
                <div className="flex justify-between"><span className="text-lantern-text-muted">Onboarding done</span><span className="font-medium">{funnel.onboardingCompleted}</span></div>
              </div>
            </Card>
          )}
          {platformEvents && (
            <Card variant="elevated">
              <h3 className="text-sm font-semibold text-lantern-text mb-3">Platform (from events)</h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-lantern-text-muted">Web DAU</span><span className="font-medium">{platformEvents.webDau}</span></div>
                <div className="flex justify-between"><span className="text-lantern-text-muted">Mobile DAU</span><span className="font-medium">{platformEvents.mobileDau}</span></div>
                <div className="flex justify-between"><span className="text-lantern-text-muted">Web active (period)</span><span className="font-medium">{platformEvents.webActivePeriod}</span></div>
                <div className="flex justify-between"><span className="text-lantern-text-muted">Mobile active (period)</span><span className="font-medium">{platformEvents.mobileActivePeriod}</span></div>
              </div>
            </Card>
          )}
        </div>
      )}

      {search && (
        <Card variant="elevated">
          <h3 className="text-sm font-semibold text-lantern-text mb-1">Search analytics</h3>
          <p className="text-xs text-lantern-text-muted mb-3">{search.totalSearches} searches in period (consent-gated events)</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-semibold text-lantern-text-muted mb-2">Top queries</p>
              {(search.topQueries?.length ?? 0) === 0 ? (
                <p className="text-sm text-lantern-text-muted">No search events yet.</p>
              ) : (
                search.topQueries.map((row) => (
                  <div key={row.query} className="flex justify-between text-sm mb-1">
                    <span className="text-lantern-text truncate mr-2">{row.query}</span>
                    <span className="font-medium">{row.count}</span>
                  </div>
                ))
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-lantern-text-muted mb-2">Zero-result queries</p>
              {(search.zeroResultQueries?.length ?? 0) === 0 ? (
                <p className="text-sm text-lantern-text-muted">None recorded.</p>
              ) : (
                search.zeroResultQueries.map((row) => (
                  <div key={row.query} className="flex justify-between text-sm mb-1">
                    <span className="text-lantern-text truncate mr-2">{row.query}</span>
                    <span className="font-medium">{row.count}</span>
                  </div>
                ))
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-lantern-text-muted mb-2">Searches by campus</p>
              {(search.searchesByCampus?.length ?? 0) === 0 ? (
                <p className="text-sm text-lantern-text-muted">No campus tags yet.</p>
              ) : (
                search.searchesByCampus.map((row) => (
                  <div key={row.campus} className="flex justify-between text-sm mb-1">
                    <span className="text-lantern-text-muted">{row.campus}</span>
                    <span className="font-medium">{row.count}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>
      )}

      {studyFunnel && (
        <Card variant="elevated">
          <h3 className="text-sm font-semibold text-lantern-text mb-1">Study funnel</h3>
          <p className="text-xs text-lantern-text-muted mb-3">
            Consent-gated study events in period. Feature totals below remain the full study_activity volume.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-semibold text-lantern-text-muted mb-2">Tests</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-lantern-text-muted">Started</span><span className="font-medium">{studyFunnel.testsStarted}</span></div>
                <div className="flex justify-between"><span className="text-lantern-text-muted">Completed</span><span className="font-medium">{studyFunnel.testsCompleted}</span></div>
                <div className="flex justify-between"><span className="text-lantern-text-muted">Completion rate</span><span className="font-medium">{studyFunnel.testsStarted > 0 ? Math.round((studyFunnel.testsCompleted / studyFunnel.testsStarted) * 100) : 0}%</span></div>
                <div className="flex justify-between"><span className="text-lantern-text-muted">Web / Mobile</span><span className="font-medium">{studyFunnel.testsCompletedWeb} / {studyFunnel.testsCompletedMobile}</span></div>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-lantern-text-muted mb-2">Flashcards &amp; notes</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-lantern-text-muted">Review sessions started</span><span className="font-medium">{studyFunnel.flashcardSessionsStarted}</span></div>
                <div className="flex justify-between"><span className="text-lantern-text-muted">Review sessions finished</span><span className="font-medium">{studyFunnel.flashcardSessionsCompleted}</span></div>
                <div className="flex justify-between"><span className="text-lantern-text-muted">Completion rate</span><span className="font-medium">{studyFunnel.flashcardSessionsStarted > 0 ? Math.round((studyFunnel.flashcardSessionsCompleted / studyFunnel.flashcardSessionsStarted) * 100) : 0}%</span></div>
                <div className="flex justify-between"><span className="text-lantern-text-muted">Notes created</span><span className="font-medium">{studyFunnel.notesCreated}</span></div>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-lantern-text-muted mb-2">AI tools ({studyFunnel.aiToolUses} uses)</p>
              {Object.keys(studyFunnel.aiToolsByType ?? {}).length === 0 ? (
                <p className="text-sm text-lantern-text-muted">No AI tool events yet.</p>
              ) : (
                <div className="space-y-1 text-sm">
                  {Object.entries(studyFunnel.aiToolsByType)
                    .sort(([, a], [, b]) => b - a)
                    .map(([tool, count]) => (
                      <div key={tool} className="flex justify-between">
                        <span className="text-lantern-text-muted capitalize">{tool.replace(/_/g, ' ')}</span>
                        <span className="font-medium">{count}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <LineChart
          title="Engagement"
          labels={labels}
          theme={theme}
          datasets={[
            { label: 'Active users', data: analytics.series.map((r) => r.activeUsers) },
            { label: 'Signups', data: analytics.series.map((r) => r.signups) },
          ]}
        />
        <LineChart
          title="Study features"
          labels={labels}
          theme={theme}
          datasets={[
            { label: 'Tests', data: analytics.series.map((r) => r.tests) },
            { label: 'Flashcards', data: analytics.series.map((r) => r.flashcards) },
            { label: 'Questions', data: analytics.series.map((r) => r.questions) },
          ]}
        />
        <LineChart
          title="Chat"
          labels={labels}
          theme={theme}
          datasets={[
            { label: 'Group messages', data: analytics.series.map((r) => r.groupMessages) },
            { label: 'DM messages', data: analytics.series.map((r) => r.dmMessages) },
          ]}
        />
        <LineChart
          title="AI & marketplace"
          labels={labels}
          theme={theme}
          datasets={[
            { label: 'AI events', data: analytics.series.map((r) => r.aiEvents) },
            { label: 'New listings', data: analytics.series.map((r) => r.newListings) },
            { label: 'Orders', data: analytics.series.map((r) => r.orders) },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SimpleChart
          title="Platform split (approx.)"
          type="doughnut"
          theme={theme}
          labels={['Mobile app', 'Web only']}
          data={[analytics.platformSplit.mobileAppUsers, analytics.platformSplit.webOnlyUsers]}
        />
        <SimpleChart
          title="Feature usage (period total)"
          type="bar"
          theme={theme}
          labels={featureLabels}
          data={featureData}
        />
        {streakLabels.length > 0 ? (
          <SimpleChart
            title="Streak distribution (days)"
            type="bar"
            theme={theme}
            labels={streakLabels}
            data={streakData}
          />
        ) : (
          <Card variant="elevated">
            <h3 className="text-sm font-semibold text-lantern-text mb-3">Streak distribution</h3>
            <p className="text-sm text-lantern-text-muted">No streak data yet.</p>
          </Card>
        )}
      </div>

      {aiEntries.length > 0 && (
        <Card variant="elevated">
          <h3 className="text-sm font-semibold text-lantern-text mb-3">AI by feature (period)</h3>
          <div className="space-y-1">
            {aiEntries.map(([event, count]) => (
              <div key={event} className="flex justify-between text-sm">
                <span className="text-lantern-text-muted">{event}</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default AdminAnalyticsPanel;
