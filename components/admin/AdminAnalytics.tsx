import React, { useEffect, useRef } from 'react';
import type { Chart as ChartType, ChartConfiguration } from 'chart.js';
import { AdminAnalytics, AdminProductEvents } from '../../services/admin';
import { Card } from '../ui/Card';
import { Select } from '../ui/Select';
import { Caption } from '../ui/Text';
import {
  AdminColumnLabel,
  AdminKpi,
  AdminMetricRow,
  AdminPageHeader,
  AdminSectionTitle,
} from './AdminChrome';
import { exportCsv } from './types';

interface AdminAnalyticsPanelProps {
  analytics: AdminAnalytics | null;
  events: AdminProductEvents | null;
  periodDays: 7 | 30 | 90;
  onPeriodChange: (days: 7 | 30 | 90) => void;
}

const CHART_COLORS = {
  light: [
    'rgba(109, 40, 217, 0.85)',
    'rgba(11, 90, 97, 0.85)',
    'rgba(4, 120, 87, 0.85)',
    'rgba(180, 83, 9, 0.85)',
    'rgba(123, 44, 171, 0.85)',
    'rgba(63, 98, 18, 0.85)',
  ],
  dark: [
    'rgba(196, 181, 253, 0.85)',
    'rgba(138, 230, 236, 0.85)',
    'rgba(110, 231, 183, 0.85)',
    'rgba(251, 191, 36, 0.85)',
    'rgba(233, 184, 255, 0.85)',
    'rgba(184, 240, 122, 0.85)',
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
      <AdminSectionTitle title={title} />
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
      <AdminSectionTitle title={title} />
      <div className={type === 'doughnut' ? 'h-52' : 'h-56'}>
        <canvas ref={canvasRef} />
      </div>
    </Card>
  );
};

const STREAK_ORDER = ['0', '1-3', '4-7', '8-14', '15+'];

export const AdminAnalyticsPanel: React.FC<AdminAnalyticsPanelProps> = ({
  analytics,
  events,
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
      <AdminPageHeader
        eyebrow="Trends"
        title="Analytics"
        description="Study activity, marketplace, and consent-gated product events. Push-token platform split is approximate."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={periodDays}
              onChange={(e) => onPeriodChange(Number(e.target.value) as 7 | 30 | 90)}
              aria-label="Period"
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </Select>
            <button
              type="button"
              onClick={onExport}
              className="text-caption font-semibold text-lantern-text-secondary hover:text-lantern-text min-h-[44px]"
            >
              Export CSV
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <AdminKpi compact label="DAU" value={analytics.kpis.dau} />
        <AdminKpi compact label="WAU" value={analytics.kpis.wau} />
        <AdminKpi compact label="MAU" value={analytics.kpis.mau} />
        <AdminKpi compact label="Total users" value={analytics.kpis.totalUsers} />
        <AdminKpi compact label="Active groups" value={analytics.kpis.activeGroups} />
        <AdminKpi compact label="Mobile app users" value={analytics.kpis.mobileAppUsers} />
        <AdminKpi compact label="Messages (period)" value={messagesTotal} />
      </div>

      {mk && (
        <Card variant="elevated">
          <AdminSectionTitle title="Marketplace (period)" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <AdminKpi compact label="GMV" value={`₦${Number(mk.gmv).toLocaleString()}`} />
            <AdminKpi compact label="Completed orders" value={mk.ordersCount} />
            <AdminKpi compact label="AOV" value={`₦${Number(mk.aov).toLocaleString()}`} />
            <AdminKpi compact label="Dispute rate" value={`${mk.disputedRate}%`} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div>
              <AdminColumnLabel>GMV by category</AdminColumnLabel>
              {(mk.gmvByCategory?.length ?? 0) === 0 ? (
                <Caption className="text-lantern-text-muted">No completed sales in period.</Caption>
              ) : (
                <div className="space-y-1.5">
                  {mk.gmvByCategory.map((row) => (
                    <AdminMetricRow
                      key={row.category}
                      label={row.category.replace(/_/g, ' ')}
                      value={`₦${Number(row.gmv).toLocaleString()} · ${row.orders}`}
                    />
                  ))}
                </div>
              )}
            </div>
            <div>
              <AdminColumnLabel>GMV by campus</AdminColumnLabel>
              {(mk.gmvByCampus?.length ?? 0) === 0 ? (
                <Caption className="text-lantern-text-muted">No campus-attributed sales yet.</Caption>
              ) : (
                <div className="space-y-1.5">
                  {mk.gmvByCampus.map((row) => (
                    <AdminMetricRow
                      key={row.campus}
                      label={row.campus}
                      value={`₦${Number(row.gmv).toLocaleString()} · ${row.orders}`}
                    />
                  ))}
                </div>
              )}
            </div>
            {(mk.gmvByZone?.length ?? 0) > 0 && (
              <div>
                <AdminColumnLabel>GMV by geopolitical zone</AdminColumnLabel>
                <div className="space-y-1.5">
                  {mk.gmvByZone?.map((row) => (
                    <AdminMetricRow
                      key={row.zone}
                      label={row.zone}
                      value={`₦${Number(row.gmv).toLocaleString()} · ${row.orders}`}
                    />
                  ))}
                </div>
              </div>
            )}
            {(mk.listingsByZone?.length ?? 0) > 0 && (
              <div>
                <AdminColumnLabel>Listings by geopolitical zone</AdminColumnLabel>
                <div className="space-y-1.5">
                  {mk.listingsByZone?.map((row) => (
                    <AdminMetricRow
                      key={row.zone}
                      label={row.zone}
                      value={`${row.total} total · ${row.active} active · ${row.sold} sold`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {(retention || funnel || platformEvents) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {retention && (
            <Card variant="elevated">
              <AdminSectionTitle
                title="Retention cohorts"
                description={`Signups 30–60 days ago (${retention.signups}). % with study activity by day.`}
              />
              <div className="grid grid-cols-3 gap-2">
                <AdminKpi compact label="D1" value={`${retention.d1}%`} />
                <AdminKpi compact label="D7" value={`${retention.d7}%`} />
                <AdminKpi compact label="D30" value={`${retention.d30}%`} />
              </div>
            </Card>
          )}
          {funnel && (
            <Card variant="elevated">
              <AdminSectionTitle title="Acquisition funnel" />
              <div className="space-y-1.5">
                <AdminMetricRow label="Guest listing views" value={funnel.guestListingViews} />
                <AdminMetricRow label="Signup started" value={funnel.signupStarted} />
                <AdminMetricRow label="Signups completed" value={funnel.signupsCompleted} />
                <AdminMetricRow label="Onboarding done" value={funnel.onboardingCompleted} />
              </div>
            </Card>
          )}
          {platformEvents && (
            <Card variant="elevated">
              <AdminSectionTitle title="Platform (from events)" />
              <div className="space-y-1.5">
                <AdminMetricRow label="Web DAU" value={platformEvents.webDau} />
                <AdminMetricRow label="Mobile DAU" value={platformEvents.mobileDau} />
                <AdminMetricRow label="Web active (period)" value={platformEvents.webActivePeriod} />
                <AdminMetricRow label="Mobile active (period)" value={platformEvents.mobileActivePeriod} />
              </div>
            </Card>
          )}
        </div>
      )}

      {search && (
        <Card variant="elevated">
          <AdminSectionTitle
            title="Search analytics"
            description={`${search.totalSearches} searches in period (consent-gated events)`}
          />
          <div className={`grid grid-cols-1 gap-4 ${search.searchesByZone?.length ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3'}`}>
            <div>
              <AdminColumnLabel>Top queries</AdminColumnLabel>
              {(search.topQueries?.length ?? 0) === 0 ? (
                <Caption className="text-lantern-text-muted">No search events yet.</Caption>
              ) : (
                <div className="space-y-1.5">
                  {search.topQueries.map((row) => (
                    <AdminMetricRow key={row.query} label={row.query} value={row.count} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <AdminColumnLabel>Zero-result queries</AdminColumnLabel>
              {(search.zeroResultQueries?.length ?? 0) === 0 ? (
                <Caption className="text-lantern-text-muted">None recorded.</Caption>
              ) : (
                <div className="space-y-1.5">
                  {search.zeroResultQueries.map((row) => (
                    <AdminMetricRow key={row.query} label={row.query} value={row.count} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <AdminColumnLabel>Searches by saved-campus context</AdminColumnLabel>
              {(search.searchesByCampus?.length ?? 0) === 0 ? (
                <Caption className="text-lantern-text-muted">No saved-campus context yet.</Caption>
              ) : (
                <div className="space-y-1.5">
                  {search.searchesByCampus.map((row) => (
                    <AdminMetricRow key={row.campus} label={row.campus} value={row.count} />
                  ))}
                </div>
              )}
            </div>
            {(search.searchesByZone?.length ?? 0) > 0 && (
              <div>
                <AdminColumnLabel>Searches by geopolitical zone</AdminColumnLabel>
                <div className="space-y-1.5">
                  {search.searchesByZone?.map((row) => (
                    <AdminMetricRow key={row.zone} label={row.zone} value={row.count} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {studyFunnel && (
        <Card variant="elevated">
          <AdminSectionTitle
            title="Study funnel"
            description="Consent-gated study events in period. Feature totals below remain the full study_activity volume."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <AdminColumnLabel>Tests</AdminColumnLabel>
              <div className="space-y-1.5">
                <AdminMetricRow label="Started" value={studyFunnel.testsStarted} />
                <AdminMetricRow label="Completed" value={studyFunnel.testsCompleted} />
                <AdminMetricRow
                  label="Completion rate"
                  value={`${studyFunnel.testsStarted > 0 ? Math.round((studyFunnel.testsCompleted / studyFunnel.testsStarted) * 100) : 0}%`}
                />
                <AdminMetricRow
                  label="Web / Mobile"
                  value={`${studyFunnel.testsCompletedWeb} / ${studyFunnel.testsCompletedMobile}`}
                />
              </div>
            </div>
            <div>
              <AdminColumnLabel>Flashcards & notes</AdminColumnLabel>
              <div className="space-y-1.5">
                <AdminMetricRow label="Review sessions started" value={studyFunnel.flashcardSessionsStarted} />
                <AdminMetricRow label="Review sessions finished" value={studyFunnel.flashcardSessionsCompleted} />
                <AdminMetricRow
                  label="Completion rate"
                  value={`${studyFunnel.flashcardSessionsStarted > 0 ? Math.round((studyFunnel.flashcardSessionsCompleted / studyFunnel.flashcardSessionsStarted) * 100) : 0}%`}
                />
                <AdminMetricRow label="Notes created" value={studyFunnel.notesCreated} />
              </div>
            </div>
            <div>
              <AdminColumnLabel>AI tools ({studyFunnel.aiToolUses} uses)</AdminColumnLabel>
              {Object.keys(studyFunnel.aiToolsByType ?? {}).length === 0 ? (
                <Caption className="text-lantern-text-muted">No AI tool events yet.</Caption>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(studyFunnel.aiToolsByType)
                    .sort(([, a], [, b]) => b - a)
                    .map(([tool, count]) => (
                      <AdminMetricRow
                        key={tool}
                        label={tool.replace(/_/g, ' ')}
                        value={count}
                      />
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
            <AdminSectionTitle title="Streak distribution" />
            <Caption className="text-lantern-text-muted">No streak data yet.</Caption>
          </Card>
        )}
      </div>

      {aiEntries.length > 0 && (
        <Card variant="elevated">
          <AdminSectionTitle title="AI by feature (period)" />
          <div className="space-y-1.5">
            {aiEntries.map(([event, count]) => (
              <AdminMetricRow key={event} label={event} value={count} />
            ))}
          </div>
        </Card>
      )}

      {events && (
        <Card variant="elevated">
          <AdminSectionTitle
            title="Event stream"
            description="Everything the clients report, unfiltered — what users are actually doing, before any funnel is built around it."
            meta={
              <Caption className="text-lantern-text-muted">
                {events.totalEvents.toLocaleString()} events · {events.uniqueUsers} users
                {events.truncated ? ' · most recent 10,000 shown' : ''}
              </Caption>
            }
          />
          <div className="space-y-1.5">
            {Object.entries(events.byEvent)
              .sort(([, a], [, b]) => b.total - a.total)
              .slice(0, 25)
              .map(([event, row]) => (
                <AdminMetricRow
                  key={event}
                  label={event}
                  value={`${row.total.toLocaleString()} · web ${row.web} · mobile ${row.mobile}`}
                />
              ))}
            {Object.keys(events.byEvent).length === 0 && (
              <Caption className="text-lantern-text-muted">No events recorded in this period.</Caption>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};

export default AdminAnalyticsPanel;
