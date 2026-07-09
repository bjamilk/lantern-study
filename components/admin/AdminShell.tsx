import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdminActivityItem,
  AdminAIUserUsage,
  AdminAuditEntry,
  AdminListing,
  AdminMarketplaceOrder,
  AdminPagination,
  AdminReport,
  AdminStats,
  AdminUser,
  AdminAnalytics,
  fetchAdminActivity,
  fetchAdminAIAnalytics,
  fetchAdminAIUserUsage,
  fetchAdminAnalytics,
  fetchAdminAudit,
  fetchAdminMarketplaceListings,
  fetchAdminMarketplaceOrders,
  fetchAdminReports,
  fetchAdminStats,
  fetchAdminUsers,
  removeAdminMarketplaceListing,
  resolveAdminMarketplaceDispute,
  resetAdminAIQuota,
  resolveAdminReport,
  updateAdminMarketplaceListingStatus,
  updateAdminUserRole,
  updateAdminUserStatus,
} from '../../services/admin';
import { Button } from '../ui/Button';
import { ScreenHeader } from '../ui/ScreenHeader';
import { AdminAI } from './AdminAI';
import { AdminAnalyticsPanel } from './AdminAnalytics';
import { AdminAudit } from './AdminAudit';
import { AdminCommunications } from './AdminCommunications';
import { AdminContentModeration } from './AdminContentModeration';
import { AdminMarketplace, AdminMarketplaceView } from './AdminMarketplace';
import { AdminOverview } from './AdminOverview';
import { AdminReports } from './AdminReports';
import { AdminUsers } from './AdminUsers';
import { ConfirmDialog } from './ConfirmDialog';
import { UserDetailDrawer } from './UserDetailDrawer';
import {
  ADMIN_TABS,
  AdminShellProps,
  AdminTab,
  ConfirmState,
  emptyTabLoading,
  exportCsv,
  statsSummary,
} from './types';

export const AdminShell: React.FC<AdminShellProps> = ({ onBackToDashboard }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [globalLoading, setGlobalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [confirmInput, setConfirmInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
  });

  const [tabLoading, setTabLoading] = useState(emptyTabLoading());
  const [loadedTabs, setLoadedTabs] = useState(emptyTabLoading());
  const tabLoadingRef = useRef(tabLoading);
  const loadedTabsRef = useRef(loadedTabs);
  tabLoadingRef.current = tabLoading;
  loadedTabsRef.current = loadedTabs;
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [activity, setActivity] = useState<AdminActivityItem[]>([]);
  const [auditEntries, setAuditEntries] = useState<AdminAuditEntry[]>([]);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersPagination, setUsersPagination] = useState<AdminPagination | null>(null);
  const [usersPage, setUsersPage] = useState(1);
  const [usersLimit] = useState(20);
  const [userSearch, setUserSearch] = useState('');
  const [debouncedUserSearch, setDebouncedUserSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [listings, setListings] = useState<AdminListing[]>([]);
  const [listingStatusFilter, setListingStatusFilter] = useState('all');
  const [listingsPagination, setListingsPagination] = useState<AdminPagination | null>(null);
  const [listingsPage, setListingsPage] = useState(1);
  const [listingsLimit] = useState(20);

  const [marketplaceView, setMarketplaceView] = useState<AdminMarketplaceView>('listings');
  const [orders, setOrders] = useState<AdminMarketplaceOrder[]>([]);
  const [orderStatusFilter, setOrderStatusFilter] = useState('disputed');
  const [orderNotes, setOrderNotes] = useState<Record<string, string>>({});
  const [ordersPagination, setOrdersPagination] = useState<AdminPagination | null>(null);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersLimit] = useState(20);
  const [disputedOrdersTotal, setDisputedOrdersTotal] = useState(0);

  const [reports, setReports] = useState<AdminReport[]>([]);
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({});
  const [reportStatusFilter, setReportStatusFilter] = useState<'open' | 'resolved' | 'dismissed'>('open');
  const [reportsPagination, setReportsPagination] = useState<AdminPagination | null>(null);
  const [reportsPage, setReportsPage] = useState(1);
  const [reportsLimit] = useState(20);

  const [aiAnalytics, setAiAnalytics] = useState<{
    totalEvents: number;
    byEvent: Record<string, number>;
    byDay: Record<string, number>;
    periodDays: number;
  } | null>(null);
  const [aiUsageByUser, setAiUsageByUser] = useState<AdminAIUserUsage[]>([]);
  const [aiPeriodDays, setAiPeriodDays] = useState(7);

  const [analyticsData, setAnalyticsData] = useState<AdminAnalytics | null>(null);
  const [analyticsPeriodDays, setAnalyticsPeriodDays] = useState<7 | 30 | 90>(30);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedUserSearch(userSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [userSearch]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  const runTabLoad = useCallback(async (tab: AdminTab, fn: () => Promise<void>, force = false) => {
    if (tabLoadingRef.current[tab]) return;
    if (loadedTabsRef.current[tab] && !force) return;
    setTabLoading((prev) => ({ ...prev, [tab]: true }));
    if (force) setGlobalLoading(true);
    setError(null);
    try {
      await fn();
      setLoadedTabs((prev) => ({ ...prev, [tab]: true }));
    } catch (err: any) {
      setError(err.message || 'Failed to load admin data');
    } finally {
      setTabLoading((prev) => ({ ...prev, [tab]: false }));
      if (force) setGlobalLoading(false);
    }
  }, []);

  const loadOverview = useCallback(
    async (force = false) => {
      await runTabLoad('overview', async () => {
        const [statsResult, activityResult, auditResult] = await Promise.allSettled([
          fetchAdminStats(),
          fetchAdminActivity(10),
          fetchAdminAudit(15),
        ]);
        if (statsResult.status === 'fulfilled') setStats(statsResult.value);
        if (activityResult.status === 'fulfilled') setActivity(activityResult.value);
        if (auditResult.status === 'fulfilled') setAuditEntries(auditResult.value);
      }, force);
    },
    [runTabLoad]
  );

  const loadUsers = useCallback(
    async (force = false) => {
      await runTabLoad('users', async () => {
        const usersData = await fetchAdminUsers({
          search: debouncedUserSearch || undefined,
          page: usersPage,
          limit: usersLimit,
        });
        setUsers(usersData.data || []);
        setUsersPagination(usersData.pagination || null);
      }, force);
    },
    [debouncedUserSearch, runTabLoad, usersLimit, usersPage]
  );

  const loadMarketplace = useCallback(
    async (force = false) => {
      await runTabLoad('marketplace', async () => {
        const disputedPeekPromise =
          orderStatusFilter === 'disputed'
            ? Promise.resolve(null)
            : fetchAdminMarketplaceOrders({ status: 'disputed', page: 1, limit: 1 });

        const [listingsData, ordersData, disputedPeek] = await Promise.all([
          fetchAdminMarketplaceListings({
            status: listingStatusFilter === 'all' ? undefined : listingStatusFilter,
            page: listingsPage,
            limit: listingsLimit,
          }),
          fetchAdminMarketplaceOrders({
            status: orderStatusFilter,
            page: ordersPage,
            limit: ordersLimit,
          }),
          disputedPeekPromise,
        ]);
        setListings(listingsData.data || []);
        setListingsPagination(listingsData.pagination || null);
        setOrders(ordersData.data || []);
        setOrdersPagination(ordersData.pagination || null);
        setDisputedOrdersTotal(
          orderStatusFilter === 'disputed'
            ? ordersData.pagination?.total ?? 0
            : disputedPeek?.pagination?.total ?? 0
        );
      }, force);
    },
    [
      listingStatusFilter,
      listingsLimit,
      listingsPage,
      orderStatusFilter,
      ordersLimit,
      ordersPage,
      runTabLoad,
    ]
  );

  const loadReports = useCallback(
    async (force = false) => {
      await runTabLoad('reports', async () => {
        const reportsData = await fetchAdminReports({
          status: reportStatusFilter,
          page: reportsPage,
          limit: reportsLimit,
        });
        setReports(reportsData.data || []);
        setReportsPagination(reportsData.pagination || null);
      }, force);
    },
    [reportStatusFilter, reportsLimit, reportsPage, runTabLoad]
  );

  const loadAI = useCallback(
    async (force = false) => {
      await runTabLoad('ai', async () => {
        const [analyticsData, usageData] = await Promise.all([
          fetchAdminAIAnalytics(aiPeriodDays),
          fetchAdminAIUserUsage(aiPeriodDays, 10),
        ]);
        setAiAnalytics(analyticsData);
        setAiUsageByUser(usageData.users || []);
      }, force);
    },
    [aiPeriodDays, runTabLoad]
  );

  const loadAnalytics = useCallback(
    async (force = false) => {
      await runTabLoad('analytics', async () => {
        setAnalyticsData(await fetchAdminAnalytics(analyticsPeriodDays));
      }, force);
    },
    [analyticsPeriodDays, runTabLoad]
  );

  const loadAudit = useCallback(
    async (force = false) => {
      await runTabLoad('audit', async () => {
        setAuditEntries(await fetchAdminAudit(50));
      }, force);
    },
    [runTabLoad]
  );

  useEffect(() => {
    if (activeTab === 'overview') loadOverview();
    if (activeTab === 'analytics') loadAnalytics();
    if (activeTab === 'reports') loadReports();
    if (activeTab === 'ai') loadAI();
    if (activeTab === 'audit') loadAudit();
    if (activeTab === 'communications') {
      setLoadedTabs((p) => (p.communications ? p : { ...p, communications: true }));
    }
    if (activeTab === 'moderation') {
      setLoadedTabs((p) => (p.moderation ? p : { ...p, moderation: true }));
    }
  }, [activeTab, loadAI, loadAnalytics, loadAudit, loadOverview, loadReports]);

  useEffect(() => {
    if (activeTab !== 'users') return;
    setLoadedTabs((prev) => ({ ...prev, users: false }));
    loadUsers();
  }, [activeTab, debouncedUserSearch, usersPage, loadUsers]);

  useEffect(() => {
    if (activeTab !== 'marketplace') return;
    setLoadedTabs((prev) => ({ ...prev, marketplace: false }));
    loadMarketplace();
  }, [activeTab, listingStatusFilter, listingsPage, orderStatusFilter, ordersPage, loadMarketplace]);

  const setOrderStatusFilterAndResetPage = (value: string) => {
    setOrderStatusFilter(value);
    setOrdersPage(1);
  };

  const setListingStatusFilterAndResetPage = (value: string) => {
    setListingStatusFilter(value);
    setListingsPage(1);
  };

  useEffect(() => {
    if (activeTab !== 'analytics') return;
    setLoadedTabs((prev) => ({ ...prev, analytics: false }));
    loadAnalytics();
  }, [analyticsPeriodDays]);

  useEffect(() => {
    if (activeTab !== 'reports') return;
    setLoadedTabs((prev) => ({ ...prev, reports: false }));
    loadReports();
  }, [reportStatusFilter, reportsPage]);

  useEffect(() => {
    if (activeTab !== 'ai') return;
    setLoadedTabs((prev) => ({ ...prev, ai: false }));
    loadAI();
  }, [aiPeriodDays]);

  const setRowLoading = (key: string, loading: boolean) => {
    setActionLoading((prev) => ({ ...prev, [key]: loading }));
  };

  const openConfirm = (next: Omit<ConfirmState, 'open'>) => {
    setConfirmInput('');
    setReasonInput('');
    setConfirmState({ ...next, open: true });
  };

  const closeConfirm = () => {
    if (confirmLoading) return;
    setConfirmInput('');
    setReasonInput('');
    setConfirmState({ open: false, title: '', message: '', confirmLabel: 'Confirm' });
  };

  const executeConfirm = async () => {
    if (!confirmState.action) return;
    if (confirmState.requiredText && confirmInput !== confirmState.requiredText) {
      setError(`Type "${confirmState.requiredText}" to confirm this action.`);
      return;
    }
    try {
      setConfirmLoading(true);
      await confirmState.action(reasonInput.trim() || undefined);
      closeConfirm();
    } catch (err: any) {
      setError(err.message || 'Action failed');
    } finally {
      setConfirmLoading(false);
    }
  };

  const onToggleBan = (user: AdminUser) => {
    const nextStatus = user.is_banned ? 'active' : 'banned';
    openConfirm({
      title: nextStatus === 'banned' ? 'Ban user' : 'Unban user',
      message: `${nextStatus === 'banned' ? 'Ban' : 'Restore'} ${user.email || user.name || user.id}?`,
      confirmLabel: nextStatus === 'banned' ? 'Ban' : 'Unban',
      danger: nextStatus === 'banned',
      reasonField: nextStatus === 'banned',
      action: async (reason) => {
        const key = `ban:${user.id}`;
        setRowLoading(key, true);
        try {
          await updateAdminUserStatus(user.id, nextStatus, reason);
          setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, is_banned: nextStatus === 'banned' } : u)));
          setSuccess(`${user.name || user.username || user.id} is now ${nextStatus}.`);
        } finally {
          setRowLoading(key, false);
        }
      },
    });
  };

  const onTogglePlatformAdmin = (user: AdminUser) => {
    const targetState = !(user.is_platform_admin === true);
    openConfirm({
      title: `${targetState ? 'Grant' : 'Revoke'} Platform Admin`,
      message: `This changes platform-wide access for ${user.email || user.name || user.id}. Type CONFIRM_ADMIN_ROLE_CHANGE to proceed.`,
      confirmLabel: targetState ? 'Grant Admin' : 'Revoke Admin',
      danger: !targetState,
      requiredText: 'CONFIRM_ADMIN_ROLE_CHANGE',
      action: async () => {
        const key = `role:${user.id}`;
        setRowLoading(key, true);
        try {
          await updateAdminUserRole(user.id, targetState, 'CONFIRM_ADMIN_ROLE_CHANGE');
          setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, is_platform_admin: targetState } : u)));
          setSuccess(targetState ? 'Platform admin granted.' : 'Platform admin revoked.');
        } finally {
          setRowLoading(key, false);
        }
      },
    });
  };

  const onRemoveListing = (listingId: string) => {
    openConfirm({
      title: 'Remove Listing',
      message: 'This will mark the listing as removed by admin and hide it from the marketplace.',
      confirmLabel: 'Remove Listing',
      danger: true,
      action: async () => {
        const key = `remove:${listingId}`;
        setRowLoading(key, true);
        try {
          await removeAdminMarketplaceListing(listingId);
          setListings((prev) => prev.filter((l) => l.id !== listingId));
          setSuccess('Listing removed successfully.');
        } finally {
          setRowLoading(key, false);
        }
      },
    });
  };

  const onResolveDispute = (
    orderId: string,
    resolution: 'release_to_seller' | 'refund_buyer'
  ) => {
    const order = orders.find((o) => o.id === orderId);
    const label =
      resolution === 'release_to_seller'
        ? 'Release escrow to seller (complete sale)'
        : 'Refund buyer and re-list item';
    openConfirm({
      title: 'Resolve marketplace dispute',
      message: `${label} for "${order?.listing?.title || orderId}"? This notifies both parties.`,
      confirmLabel: resolution === 'release_to_seller' ? 'Release to seller' : 'Refund buyer',
      danger: resolution === 'refund_buyer',
      action: async () => {
        const note = orderNotes[orderId]?.trim() || undefined;
        const key = `dispute:${orderId}:${resolution}`;
        setRowLoading(key, true);
        try {
          await resolveAdminMarketplaceDispute(orderId, resolution, note);
          setOrders((prev) => prev.filter((o) => o.id !== orderId));
          setDisputedOrdersTotal((prev) => Math.max(0, prev - 1));
          setSuccess('Dispute resolved.');
        } finally {
          setRowLoading(key, false);
        }
      },
    });
  };

  const onToggleSuspendListing = async (listing: AdminListing) => {
    const nextStatus = listing.status === 'suspended_by_admin' ? 'active' : 'suspended_by_admin';
    const key = `suspend:${listing.id}`;
    setRowLoading(key, true);
    try {
      await updateAdminMarketplaceListingStatus(listing.id, nextStatus);
      setListings((prev) => prev.map((l) => (l.id === listing.id ? { ...l, status: nextStatus } : l)));
      setSuccess(nextStatus === 'active' ? 'Listing restored.' : 'Listing suspended.');
    } catch (err: any) {
      setError(err.message || 'Failed to update listing status');
    } finally {
      setRowLoading(key, false);
    }
  };

  const onResolveReport = async (reportId: string, action: 'dismiss' | 'remove_listing' | 'warn_seller') => {
    const key = `report:${reportId}:${action}`;
    setRowLoading(key, true);
    try {
      await resolveAdminReport(reportId, action, reportNotes[reportId]?.trim() || undefined);
      setReports((prev) => prev.filter((r) => r.id !== reportId));
      setSuccess('Report action applied successfully.');
    } catch (err: any) {
      setError(err.message || 'Failed to resolve report');
    } finally {
      setRowLoading(key, false);
    }
  };

  const onBulkDismissReports = async () => {
    for (const report of reports) {
      await resolveAdminReport(report.id, 'dismiss');
    }
    setReports([]);
    setSuccess('Visible reports dismissed.');
  };

  const onResetQuota = async (userId: string) => {
    const key = `quota:${userId}`;
    setRowLoading(key, true);
    try {
      await resetAdminAIQuota(userId);
      setSuccess('AI quota reset.');
    } catch (err: any) {
      setError(err.message || 'Reset failed');
    } finally {
      setRowLoading(key, false);
    }
  };

  const onRefreshCurrent = async () => {
    if (activeTab === 'overview') await loadOverview(true);
    if (activeTab === 'analytics') await loadAnalytics(true);
    if (activeTab === 'users') await loadUsers(true);
    if (activeTab === 'marketplace') await loadMarketplace(true);
    if (activeTab === 'reports') await loadReports(true);
    if (activeTab === 'ai') await loadAI(true);
    if (activeTab === 'audit') await loadAudit(true);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 w-full max-w-full bg-lantern-background">
      <div className="shrink-0 px-4 md:px-6 pt-4 md:pt-6 pb-3 space-y-3 border-b border-lantern-border bg-lantern-background">
        <ScreenHeader
          title="Admin Console"
          subtitle="Platform oversight and moderation"
          className="mb-0"
          actions={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={onRefreshCurrent} loading={globalLoading}>
                Refresh
              </Button>
              <Button variant="primary" size="sm" onClick={onBackToDashboard}>
                Back to Dashboard
              </Button>
            </div>
          }
        />

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin shrink-0">
          {ADMIN_TABS.map((tab) => (
            <Button
              key={tab.id}
              size="sm"
              variant={activeTab === tab.id ? 'primary' : 'ghost'}
              onClick={() => setActiveTab(tab.id)}
              className="shrink-0"
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {tabLoading[activeTab] && <p className="text-sm text-lantern-text-muted">Loading…</p>}
        {error && <p className="text-sm text-lantern-error">{error}</p>}
        {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">{success}</p>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
      {activeTab === 'overview' && (
        <AdminOverview
          stats={stats}
          activity={activity}
          onExportStats={() => stats && exportCsv('admin-stats.csv', statsSummary(stats))}
        />
      )}

      {activeTab === 'analytics' && (
        <AdminAnalyticsPanel
          analytics={analyticsData}
          periodDays={analyticsPeriodDays}
          onPeriodChange={setAnalyticsPeriodDays}
        />
      )}

      {activeTab === 'users' && (
        <AdminUsers
          users={users}
          pagination={usersPagination}
          userSearch={userSearch}
          actionLoading={actionLoading}
          onSearchChange={setUserSearch}
          onPrev={() => setUsersPage((p) => Math.max(1, p - 1))}
          onNext={() => setUsersPage((p) => p + 1)}
          onSelectUser={setSelectedUserId}
          onToggleBan={onToggleBan}
          onToggleAdmin={onTogglePlatformAdmin}
        />
      )}

      {activeTab === 'marketplace' && (
        <AdminMarketplace
          view={marketplaceView}
          onViewChange={setMarketplaceView}
          listings={listings}
          listingsPagination={listingsPagination}
          listingStatusFilter={listingStatusFilter}
          onListingStatusFilterChange={setListingStatusFilterAndResetPage}
          onListingsPrev={() => setListingsPage((p) => Math.max(1, p - 1))}
          onListingsNext={() => setListingsPage((p) => p + 1)}
          onRemove={onRemoveListing}
          onToggleSuspend={onToggleSuspendListing}
          orders={orders}
          ordersPagination={ordersPagination}
          orderStatusFilter={orderStatusFilter}
          orderNotes={orderNotes}
          onOrderStatusFilterChange={setOrderStatusFilterAndResetPage}
          onOrdersPrev={() => setOrdersPage((p) => Math.max(1, p - 1))}
          onOrdersNext={() => setOrdersPage((p) => p + 1)}
          onOrderNoteChange={(id, note) => setOrderNotes((prev) => ({ ...prev, [id]: note }))}
          onResolveDispute={onResolveDispute}
          disputedOrdersTotal={disputedOrdersTotal}
          actionLoading={actionLoading}
        />
      )}

      {activeTab === 'reports' && (
        <AdminReports
          reports={reports}
          pagination={reportsPagination}
          statusFilter={reportStatusFilter}
          reportNotes={reportNotes}
          actionLoading={actionLoading}
          onStatusFilterChange={setReportStatusFilter}
          onNoteChange={(id, note) => setReportNotes((prev) => ({ ...prev, [id]: note }))}
          onPrev={() => setReportsPage((p) => Math.max(1, p - 1))}
          onNext={() => setReportsPage((p) => p + 1)}
          onResolve={onResolveReport}
          onBulkDismiss={onBulkDismissReports}
        />
      )}

      {activeTab === 'ai' && (
        <AdminAI
          analytics={aiAnalytics}
          usageByUser={aiUsageByUser}
          periodDays={aiPeriodDays}
          onPeriodChange={setAiPeriodDays}
          onSelectUser={setSelectedUserId}
          onResetQuota={onResetQuota}
          actionLoading={actionLoading}
        />
      )}

      {activeTab === 'communications' && (
        <AdminCommunications onSent={setSuccess} onError={setError} />
      )}

      {activeTab === 'moderation' && (
        <AdminContentModeration onSuccess={setSuccess} onError={setError} />
      )}

      {activeTab === 'audit' && <AdminAudit entries={auditEntries} />}

      {activeTab === 'overview' && auditEntries.length > 0 && (
        <AdminAudit entries={auditEntries.slice(0, 8)} />
      )}
      </div>

      <UserDetailDrawer userId={selectedUserId} onClose={() => setSelectedUserId(null)} onUpdated={() => loadUsers(true)} />

      <ConfirmDialog
        state={confirmState}
        confirmInput={confirmInput}
        reasonInput={reasonInput}
        confirmLoading={confirmLoading}
        onConfirmInputChange={setConfirmInput}
        onReasonInputChange={setReasonInput}
        onClose={closeConfirm}
        onConfirm={executeConfirm}
      />
    </div>
  );
};

export default AdminShell;
