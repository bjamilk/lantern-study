import React, { useEffect, useState } from 'react';
import {
  fetchAdminJobCompanies,
  fetchAdminJobPostings,
  fetchAdminJobReports,
  resolveAdminJobReport,
  setAdminJobCompanyVerification,
  updateAdminJobPostingStatus,
  removeAdminJobPosting,
  schoolApproveAdminJobPosting,
} from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Body, Caption } from '../ui/Text';
import {
  AdminEmpty,
  AdminPageHeader,
  AdminRowActions,
  AdminStatusBadge,
  AdminTable,
  adminCellClass,
  adminRowClass,
} from './AdminChrome';

export function AdminJobs() {
  const [postings, setPostings] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError(null);
    // Settled, not all-or-nothing: one failing endpoint must not blank the
    // two sections that loaded fine.
    const [p, c, r] = await Promise.allSettled([
      fetchAdminJobPostings({ page: 1, limit: 50 }),
      fetchAdminJobCompanies({ page: 1, limit: 50, status: 'pending' }),
      fetchAdminJobReports('pending'),
    ]);
    if (p.status === 'fulfilled') setPostings(p.value.data || []);
    if (c.status === 'fulfilled') setCompanies(c.value.data || []);
    if (r.status === 'fulfilled') setReports(r.value.data || []);
    const failed = [p, c, r].find((x): x is PromiseRejectedResult => x.status === 'rejected');
    if (failed) {
      const reason = failed.reason;
      setError(reason instanceof Error ? reason.message : 'Failed to load jobs admin');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every mutation runs through here: busy always resets (a thrown request
  // used to leave busy=true forever, disabling all buttons with no feedback),
  // and failures reach the error banner instead of vanishing as unhandled
  // rejections.
  const runAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="Careers"
        title="Jobs"
        description="Verify companies, resolve reports, and suspend or school-approve postings."
      />
      {error ? (
        <div className="rounded-lantern border border-lantern-error/30 bg-lantern-error/10 px-3 py-2">
          <Body className="text-lantern-error">{error}</Body>
        </div>
      ) : null}

      <section className="space-y-3">
        <Caption className="font-semibold uppercase tracking-wide text-lantern-text-muted">
          Pending company verification
        </Caption>
        {companies.length === 0 ? (
          <AdminEmpty>No pending companies.</AdminEmpty>
        ) : (
          companies.map((c) => (
            <Card key={c.id} padding="md" className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <Body className="font-semibold text-lantern-text">{c.displayName}</Body>
                <Caption className="text-lantern-text-muted">{c.verificationDomain || c.website}</Caption>
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void runAction(async () => {
                    await setAdminJobCompanyVerification(c.id, 'verified');
                  })
                }
              >
                Verify
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  const note =
                    window.prompt('Optional rejection note for the company owners:') || undefined;
                  void runAction(async () => {
                    await setAdminJobCompanyVerification(c.id, 'rejected', note);
                  });
                }}
              >
                Reject
              </Button>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-3">
        <Caption className="font-semibold uppercase tracking-wide text-lantern-text-muted">
          Open job reports
        </Caption>
        {reports.length === 0 ? (
          <AdminEmpty>No open reports.</AdminEmpty>
        ) : (
          reports.map((r) => (
            <Card key={r.id} padding="md" className="space-y-3">
              <div>
                <Body className="font-semibold text-lantern-text">
                  {r.reason} — {r.posting?.title || r.posting_id}
                </Body>
                {r.details ? <Caption className="text-lantern-text-secondary mt-1">{r.details}</Caption> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      if (r.posting_id || r.posting?.id) {
                        await removeAdminJobPosting(r.posting?.id || r.posting_id);
                      }
                      await resolveAdminJobReport(r.id, 'resolved');
                    })
                  }
                >
                  Remove job
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      await resolveAdminJobReport(r.id, 'dismissed');
                    })
                  }
                >
                  Dismiss
                </Button>
              </div>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-3">
        <Caption className="font-semibold uppercase tracking-wide text-lantern-text-muted">
          Recent job posts
        </Caption>
        {postings.length ? (
          <AdminTable headers={['Title', 'Type', 'Status', 'Actions']}>
            {postings.map((p) => (
              <tr key={p.id} className={adminRowClass}>
                <td className={adminCellClass}>{p.title}</td>
                <td className={`${adminCellClass} text-lantern-text-muted`}>{p.employment_type}</td>
                <td className={adminCellClass}>
                  <AdminStatusBadge
                    tone={
                      p.status === 'active'
                        ? 'success'
                        : p.status === 'suspended_by_admin'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {String(p.status || '').replace(/_/g, ' ')}
                  </AdminStatusBadge>
                </td>
                <td className={`${adminCellClass} whitespace-nowrap`}>
                  <AdminRowActions>
                    {p.status === 'pending_school_approval' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            await schoolApproveAdminJobPosting(p.id, true);
                          })
                        }
                      >
                        School approve
                      </Button>
                    ) : null}
                    {p.status === 'active' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            await updateAdminJobPostingStatus(p.id, 'suspended_by_admin');
                          })
                        }
                      >
                        Suspend
                      </Button>
                    ) : p.status === 'suspended_by_admin' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            await updateAdminJobPostingStatus(p.id, 'active');
                          })
                        }
                      >
                        Activate
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() =>
                        void runAction(async () => {
                          await removeAdminJobPosting(p.id);
                        })
                      }
                    >
                      Remove
                    </Button>
                  </AdminRowActions>
                </td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <AdminEmpty>No recent job posts.</AdminEmpty>
        )}
      </section>
    </div>
  );
}

export default AdminJobs;
