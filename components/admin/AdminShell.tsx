import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdminActivityItem,
  AdminAIUserUsage,
  AdminAuditEntry,
  AdminListing,
  AdminMarketplaceOrder,
  AdminPagination,
  AdminReport,
  AdminReportAction,
  AdminStats,
  AdminUser,
  AdminAnalytics,
  AdminAITokens,
  AdminProductEvents,
  fetchAdminActivity,
  fetchAdminAIAnalytics,
  fetchAdminAITokens,
  fetchAdminAIUserUsage,
  fetchAdminAnalytics,
  fetchAdminProductEvents,
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
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/Button';
import { AppIcon } from '../ui/AppIcon';
import { Body, Caption, Title } from '../ui/Text';
import { AdminPageHeader } from './AdminChrome';
import { AdminAI } from './AdminAI';
import { AdminAnalyticsPanel } from './AdminAnalytics';
import { AdminAudit } from './AdminAudit';
import { AdminCommunications } from './AdminCommunications';
import { AdminContentModeration } from './AdminContentModeration';
import { AdminMarketplace, AdminMarketplaceView } from './AdminMarketplace';
import { AdminJobs } from './AdminJobs';
import { AdminNav } from './AdminNav';
import { AdminOverview } from './AdminOverview';
import { AdminProductFeatures } from './AdminProductFeatures';
import { AdminReports, type AdminReportStatusFilter, type AdminReportTargetFilter } from './AdminReports';
import { AdminUsers } from './AdminUsers';
import { ConfirmDialog } from './ConfirmDialog';
import { UserDetailDrawer } from './UserDetailDrawer';
import {
  AdminShellProps,
  AdminTab,
  ConfirmState,
  emptyTabLoading,
  exportCsv,
  statsSummary,
} from './types';

export const AdminShell: React.FC<AdminShellProps> = ({ onBackToDashboard }) => {
  const operatorEmail = useAuthStore((s) => s.currentUser?.email);
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
  // Guard refs are written synchronously by runTabLoad/invalidateTab, never
  // mirrored from state during render: a render-time mirror lags one commit
  // behind, so "invalidate then reload" in a single effect saw the stale
  // loaded=true and skipped the fetch — which is how every filter change
  // (order status, report status, AI/analytics period, user search) turned
  // into a silent no-op, and how triple-mounted effects triple-fetched.
  const tabLoadingRef = useRef(emptyTabLoading());
  const loadedTabsRef = useRef(emptyTabLoading());
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [activity, setActivity] = useState<AdminActivityItem[]>([]);
  const [overviewAudit, setOverviewAudit] = useState<AdminAuditEntry[]>([]);
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
  const [reportStatusFilter, setReportStatusFilter] = useState<AdminReportStatusFilter>('open');
  const [reportTargetFilter, setReportTargetFilter] = useState<AdminReportTargetFilter>('all');
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
  const [aiTokens, setAiTokens] = useState<AdminAITokens | null>(null);
  const [aiPeriodDays, setAiPeriodDays] = useState(7);

  const [analyticsData, setAnalyticsData] = useState<AdminAnalytics | null>(null);
  const [productEvents, setProductEvents] = useState<AdminProductEvents | null>(null);
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
    tabLoadingRef.current = { ...tabLoadingRef.current, [tab]: true };
    setTabLoading((prev) => ({ ...prev, [tab]: true }));
    if (force) setGlobalLoading(true);
    setError(null);
    try {
      await fn();
      loadedTabsRef.current = { ...loadedTabsRef.current, [tab]: true };
      setLoadedTabs((prev) => ({ ...prev, [tab]: true }));
    } catch (err: any) {
      setError(err.message || 'Failed to load admin data');
    } finally {
      tabLoadingRef.current = { ...tabLoadingRef.current, [tab]: false };
      setTabLoading((prev) => ({ ...prev, [tab]: false }));
      if (force) setGlobalLoading(false);
    }
  }, []);

  /** Mark a tab stale so the next runTabLoad refetches. Must update the ref
   *  synchronously — callers invoke the load in the same tick. */
  const invalidateTab = useCallback((tab: AdminTab) => {
    loadedTabsRef.current = { ...loadedTabsRef.current, [tab]: false };
    setLoadedTabs((prev) => ({ ...prev, [tab]: false }));
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
        // Overview keeps its own audit slice: it fetches 15 rows while the
        // Audit tab fetches 50, and sharing one state let a later Overview
        // refresh silently truncate the Audit tab.
        if (auditResult.status === 'fulfilled') setOverviewAudit(auditResult.value);
        // Rethrow the first failure so runTabLoad shows the error banner and
        // leaves the tab un-loaded (retried on next entry). Swallowing it
        // rendered a fully blank tab that never recovered without Refresh.
        const failed = [statsResult, activityResult, auditResult].find(
          (r): r is PromiseRejectedResult => r.status === 'rejected'
        );
        if (failed) throw failed.reason;
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

        // Settled, not all-or-nothing: one failing request must not blank the
        // sections that succeeded. The disputed-count peek is cosmetic and is
        // never allowed to fail the tab.
        const [listingsRes, ordersRes, disputedRes] = await Promise.allSettled([
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
        if (listingsRes.status === 'fulfilled') {
          setListings(listingsRes.value.data || []);
          setListingsPagination(listingsRes.value.pagination || null);
        }
        if (ordersRes.status === 'fulfilled') {
          setOrders(ordersRes.value.data || []);
          setOrdersPagination(ordersRes.value.pagination || null);
          if (orderStatusFilter === 'disputed') {
            setDisputedOrdersTotal(ordersRes.value.pagination?.total ?? 0);
          }
        }
        if (orderStatusFilter !== 'disputed' && disputedRes.status === 'fulfilled') {
          setDisputedOrdersTotal(disputedRes.value?.pagination?.total ?? 0);
        }
        const failed = [listingsRes, ordersRes].find(
          (r): r is PromiseRejectedResult => r.status === 'rejected'
        );
        if (failed) throw failed.reason;
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
          targetType: reportTargetFilter === 'all' ? undefined : reportTargetFilter,
          page: reportsPage,
          limit: reportsLimit,
        });
        setReports(reportsData.data || []);
        setReportsPagination(reportsData.pagination || null);
      }, force);
    },
    [reportStatusFilter, reportTargetFilter, reportsLimit, reportsPage, runTabLoad]
  );

  const loadAI = useCallback(
    async (force = false) => {
      await runTabLoad('ai', async () => {
        const [analyticsRes, usageRes, tokensRes] = await Promise.allSettled([
          fetchAdminAIAnalytics(aiPeriodDays),
          fetchAdminAIUserUsage(aiPeriodDays, 10),
          fetchAdminAITokens(aiPeriodDays),
        ]);
        if (analyticsRes.status === 'fulfilled') setAiAnalytics(analyticsRes.value);
        if (usageRes.status === 'fulfilled') setAiUsageByUser(usageRes.value?.users || []);
        if (tokensRes.status === 'fulfilled') setAiTokens(tokensRes.value);
        const failed = [analyticsRes, usageRes, tokensRes].find(
          (r): r is PromiseRejectedResult => r.status === 'rejected'
        );
        if (failed) throw failed.reason;
      }, force);
    },
    [aiPeriodDays, runTabLoad]
  );

  const loadAnalytics = useCallback(
    async (force = false) => {
      await runTabLoad('analytics', async () => {
        const [analyticsRes, eventsRes] = await Promise.allSettled([
          fetchAdminAnalytics(analyticsPeriodDays),
          fetchAdminProductEvents(analyticsPeriodDays),
        ]);
        if (eventsRes.status === 'fulfilled') setProductEvents(eventsRes.value);
        if (analyticsRes.status === 'fulfilled') setAnalyticsData(analyticsRes.value);
        else throw analyticsRes.reason;
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
    if (activeTab === 'audit') loadAudit();
    if (activeTab === 'features') {
      setLoadedTabs((p) => (p.features ? p : { ...p, features: true }));
    }
    if (activeTab === 'communications') {
      setLoadedTabs((p) => (p.communications ? p : { ...p, communications: true }));
    }
    if (activeTab === 'moderation') {
      setLoadedTabs((p) => (p.moderation ? p : { ...p, moderation: true }));
    }
  }, [activeTab, loadAudit, loadOverview]);

  // Filtered tabs invalidate before loading, so changing a filter, period,
  // page or search actually refetches. Each load callback's identity changes
  // with its filter deps, which is what re-fires these effects.
  useEffect(() => {
    if (activeTab !== 'analytics') return;
    invalidateTab('analytics');
    loadAnalytics();
  }, [activeTab, loadAnalytics, invalidateTab]);

  useEffect(() => {
    if (activeTab !== 'reports') return;
    invalidateTab('reports');
    loadReports();
  }, [activeTab, loadReports, invalidateTab]);

  useEffect(() => {
    if (activeTab !== 'ai') return;
    invalidateTab('ai');
    loadAI();
  }, [activeTab, loadAI, invalidateTab]);

  useEffect(() => {
    if (activeTab !== 'users') return;
    invalidateTab('users');
    loadUsers();
  }, [activeTab, debouncedUserSearch, usersPage, loadUsers, invalidateTab]);

  useEffect(() => {
    if (activeTab !== 'marketplace') return;
    invalidateTab('marketplace');
    loadMarketplace();
  }, [activeTab, listingStatusFilter, listingsPage, orderStatusFilter, ordersPage, loadMarketplace, invalidateTab]);

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
  }, [reportStatusFilter, reportTargetFilter, reportsPage]);

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
        ? 'Force payout to seller (complete sale)'
        : 'Refund buyer and re-list item';
    openConfirm({
      title: 'Resolve marketplace dispute',
      message: `${label} for "${order?.listing?.title || orderId}"? This notifies both parties.`,
      confirmLabel: resolution === 'release_to_seller' ? 'Force payout' : 'Refund buyer',
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

  const onResolveReport = async (reportId: string, action: AdminReportAction, severity?: 1 | 2 | 3) => {
    const key = `report:${reportId}:${action}`;
    setRowLoading(key, true);
    try {
      const result = await resolveAdminReport(reportId, action, reportNotes[reportId]?.trim() || undefined, severity);
      if (action === 'under_review') {
        // Still open: keep the row, just reflect the new status.
        setReports((prev) => prev.map((r) => (r.id === reportId ? { ...r, status: 'under_review' } : r)));
        setSuccess('Report marked under review.');
      } else {
        setReports((prev) => prev.filter((r) => r.id !== reportId));
        if (action === 'strike') {
          setSuccess(
            result?.suspendedUntil
              ? `Strike issued — owner auto-suspended until ${new Date(result.suspendedUntil).toLocaleDateString()}.`
              : 'Strike issued and report resolved.'
          );
        } else if (action === 'remove_content') {
          setSuccess('Content removed and report resolved.');
        } else if (action === 'warn') {
          setSuccess('Owner warned and report resolved.');
        } else {
          setSuccess('Report dismissed.');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resolve report');
    } finally {
      setRowLoading(key, false);
    }
  };

  const onBulkDismissReports = async () => {
    let dismissed = 0;
    try {
      for (const report of reports) {
        await resolveAdminReport(report.id, 'dismiss');
        dismissed += 1;
      }
      setReports([]);
      setSuccess('Visible reports dismissed.');
    } catch (err: any) {
      // Partial failure: refetch so the list reflects what actually happened
      // instead of silently keeping already-dismissed rows on screen.
      setError(
        `Dismissed ${dismissed} of ${reports.length} report${reports.length === 1 ? '' : 's'}: ${err.message || 'request failed'}`
      );
      invalidateTab('reports');
      void loadReports();
    }
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

  const navBadges: Partial<Record<AdminTab, number>> = {
    reports: stats?.openReports ?? 0,
    marketplace: stats?.openDisputes ?? 0,
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 w-full max-w-full bg-lantern-background">
      <header className="shrink-0 border-b border-lantern-border bg-lantern-surface">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 md:px-6 py-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lantern bg-lantern-feature-campus-tint text-lantern-feature-campus-ink">
              <AppIcon name="shield-checkmark" size={20} />
            </div>
            <div className="min-w-0">
              <Title>Admin</Title>
              <Caption className="text-lantern-text-secondary mt-0.5">
                {operatorEmail ? `Signed in as ${operatorEmail}` : 'Platform oversight and moderation'}
              </Caption>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onRefreshCurrent} loading={globalLoading}>
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={onBackToDashboard}>
              Back to Dashboard
            </Button>
          </div>
        </div>

        {tabLoading[activeTab] ? (
          <div className="h-0.5 overflow-hidden bg-lantern-feature-campus-tint" aria-hidden>
            <div className="h-full w-1/3 animate-pulse bg-lantern-feature-campus-ink" />
          </div>
        ) : null}

        {(error || success) && (
          <div className="px-4 md:px-6 pb-3 space-y-2">
            {error ? (
              <div
                role="alert"
                className="rounded-lantern border border-lantern-error/30 bg-lantern-error/10 px-3 py-2"
              >
                <Body className="text-lantern-error">{error}</Body>
              </div>
            ) : null}
            {success ? (
              <div
                role="status"
                aria-live="polite"
                className="rounded-lantern border border-lantern-success/30 bg-lantern-success/10 px-3 py-2"
              >
                <Body className="text-lantern-success">{success}</Body>
              </div>
            ) : null}
          </div>
        )}

        <div className="md:hidden px-4 pb-3">
          <AdminNav activeTab={activeTab} onSelect={setActiveTab} badges={navBadges} variant="strip" />
        </div>
      </header>

      <div className="flex flex-1 min-h-0 min-w-0">
        <aside className="hidden md:flex w-52 shrink-0 flex-col border-r border-lantern-border bg-lantern-surface overflow-y-auto px-3 py-4">
          <AdminNav activeTab={activeTab} onSelect={setActiveTab} badges={navBadges} variant="rail" />
        </aside>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 md:px-6 py-5 pb-20 md:pb-6">
          {activeTab === 'overview' && (
            <AdminOverview
              stats={stats}
              activity={activity}
              audit={overviewAudit}
              loading={tabLoading.overview}
              onExportStats={() => stats && exportCsv('admin-stats.csv', statsSummary(stats))}
              onOpenTab={setActiveTab}
            />
          )}

          {activeTab === 'features' && <AdminProductFeatures />}

          {activeTab === 'analytics' && (
            <AdminAnalyticsPanel
              analytics={analyticsData}
              events={productEvents}
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
              loading={tabLoading.users}
              onSearchChange={setUserSearch}
              onPrev={() => setUsersPage((p) => Math.max(1, p - 1))}
              onNext={() => setUsersPage((p) => p + 1)}
              onSelectUser={setSelectedUserId}
              onToggleBan={onToggleBan}
              onToggleAdmin={onTogglePlatformAdmin}
              roleManagementEnabled={stats?.roleManagementEnabled}
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
              onSuccess={setSuccess}
              onError={setError}
            />
          )}

          {activeTab === 'jobs' && <AdminJobs />}

          {activeTab === 'reports' && (
            <AdminReports
              reports={reports}
              pagination={reportsPagination}
              statusFilter={reportStatusFilter}
              targetTypeFilter={reportTargetFilter}
              reportNotes={reportNotes}
              actionLoading={actionLoading}
              onStatusFilterChange={(value) => {
                setReportsPage(1);
                setReportStatusFilter(value);
              }}
              onTargetTypeFilterChange={(value) => {
                setReportsPage(1);
                setReportTargetFilter(value);
              }}
              onNoteChange={(id, note) => setReportNotes((prev) => ({ ...prev, [id]: note }))}
              onPrev={() => setReportsPage((p) => Math.max(1, p - 1))}
              onNext={() => setReportsPage((p) => p + 1)}
              onResolve={onResolveReport}
              onBulkDismiss={onBulkDismissReports}
              onSelectUser={setSelectedUserId}
              loading={tabLoading.reports}
            />
          )}

          {activeTab === 'ai' && (
            <AdminAI
              analytics={aiAnalytics}
              tokens={aiTokens}
              usageByUser={aiUsageByUser}
              periodDays={aiPeriodDays}
              onPeriodChange={setAiPeriodDays}
              onSelectUser={setSelectedUserId}
              onResetQuota={onResetQuota}
              actionLoading={actionLoading}
            />
          )}

          {activeTab === 'communications' && <AdminCommunications onSent={setSuccess} onError={setError} />}

          {activeTab === 'moderation' && <AdminContentModeration onSuccess={setSuccess} onError={setError} />}

          {activeTab === 'audit' && (
            <div className="space-y-4">
              <AdminPageHeader
                eyebrow="Log"
                title="Audit"
                description="Who changed what. Overview shows a recent slice; this is the fuller trail."
              />
              <AdminAudit entries={auditEntries} title="Recent actions" />
            </div>
          )}
        </div>
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
