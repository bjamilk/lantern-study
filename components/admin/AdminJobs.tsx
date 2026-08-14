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
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-lantern-text">Jobs board moderation</h2>
        <p className="text-sm text-lantern-text-secondary">
          Suspend/remove posts, verify companies, resolve reports, school-approve roles.
        </p>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Pending company verification</h3>
        {companies.length === 0 ? (
          <p className="text-xs text-lantern-text-tertiary">No pending companies.</p>
        ) : (
          companies.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 border border-lantern-border rounded-lg p-2 text-sm">
              <span className="font-medium">{c.displayName}</span>
              <span className="text-lantern-text-tertiary">{c.verificationDomain || c.website}</span>
              <button
                type="button"
                disabled={busy}
                className="text-xs px-2 py-1 rounded bg-emerald-600 text-white"
                onClick={() =>
                  void runAction(async () => {
                    await setAdminJobCompanyVerification(c.id, 'verified');
                  })
                }
              >
                Verify
              </button>
              <button
                type="button"
                disabled={busy}
                className="text-xs px-2 py-1 rounded border border-lantern-border"
                onClick={() => {
                  const note =
                    window.prompt('Optional rejection note for the company owners:') || undefined;
                  void runAction(async () => {
                    await setAdminJobCompanyVerification(c.id, 'rejected', note);
                  });
                }}
              >
                Reject
              </button>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Open job reports</h3>
        {reports.length === 0 ? (
          <p className="text-xs text-lantern-text-tertiary">No open reports.</p>
        ) : (
          reports.map((r) => (
            <div key={r.id} className="border border-lantern-border rounded-lg p-2 text-sm space-y-1">
              <p>
                {r.reason} — {r.posting?.title || r.posting_id}
              </p>
              {r.details ? (
                <p className="text-xs text-lantern-text-secondary">{r.details}</p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded border"
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
                </button>
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded border"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      await resolveAdminJobReport(r.id, 'dismissed');
                    })
                  }
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Recent job posts</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-lantern-text-tertiary">
                <th className="py-1 pr-2">Title</th>
                <th className="py-1 pr-2">Type</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {postings.map((p) => (
                <tr key={p.id} className="border-t border-lantern-border">
                  <td className="py-2 pr-2">{p.title}</td>
                  <td className="py-2 pr-2">{p.employment_type}</td>
                  <td className="py-2 pr-2">{p.status}</td>
                  <td className="py-2 space-x-1">
                    {p.status === 'pending_school_approval' ? (
                      <button
                        type="button"
                        disabled={busy}
                        className="text-xs px-2 py-1 rounded border"
                        onClick={() =>
                          void runAction(async () => {
                            await schoolApproveAdminJobPosting(p.id, true);
                          })
                        }
                      >
                        School approve
                      </button>
                    ) : null}
                    {p.status === 'active' ? (
                      <button
                        type="button"
                        disabled={busy}
                        className="text-xs px-2 py-1 rounded border"
                        onClick={() =>
                          void runAction(async () => {
                            await updateAdminJobPostingStatus(p.id, 'suspended_by_admin');
                          })
                        }
                      >
                        Suspend
                      </button>
                    ) : p.status === 'suspended_by_admin' ? (
                      <button
                        type="button"
                        disabled={busy}
                        className="text-xs px-2 py-1 rounded border"
                        onClick={() =>
                          void runAction(async () => {
                            await updateAdminJobPostingStatus(p.id, 'active');
                          })
                        }
                      >
                        Activate
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      className="text-xs px-2 py-1 rounded border text-red-600"
                      onClick={() =>
                        void runAction(async () => {
                          await removeAdminJobPosting(p.id);
                        })
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default AdminJobs;
