import React, { useEffect, useState } from 'react';
import {
  fetchPaystackBanks,
  fetchSellerPayoutProfile,
  upsertSellerPayoutProfile,
} from '../../services/supabase';

type Bank = { name: string; code: string };

type Props = {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

export function SellerPayoutSetup({ showToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [profile, setProfile] = useState<{
    account_name?: string | null;
    account_number_last4?: string | null;
    bank_code?: string | null;
    status?: string;
  } | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [bankCode, setBankCode] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, b] = await Promise.all([
          fetchSellerPayoutProfile(),
          fetchPaystackBanks().catch(() => []),
        ]);
        if (cancelled) return;
        setProfile(p);
        setBanks(b || []);
        if (p?.bank_code) setBankCode(p.bank_code);
      } catch (err: any) {
        if (!cancelled) showToast(err?.message || 'Could not load payout settings', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountNumber.trim() || !bankCode) {
      showToast('Enter account number and select a bank', 'error');
      return;
    }
    setSaving(true);
    try {
      const saved = await upsertSellerPayoutProfile({
        accountNumber: accountNumber.trim(),
        bankCode,
      });
      setProfile(saved);
      setAccountNumber('');
      showToast('Payout bank account saved');
    } catch (err: any) {
      showToast(err?.message || 'Could not save bank account', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Loading payout settings…</p>;
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Payout bank account</h3>
        <p className="text-sm text-slate-600 mt-1">
          Buyers pay via Paystack and your earnings are transferred here.
        </p>
        <ul className="text-sm text-slate-600 mt-2 space-y-1 list-disc pl-5">
          <li>
            <span className="font-medium text-slate-900">Items you hand over</span> — buyers pay your
            list price and Lantern keeps a 5% fee, so you receive 95% once they confirm delivery.
          </li>
          <li>
            <span className="font-medium text-slate-900">Study packs &amp; question banks</span> — buyers
            pay your list price and Lantern keeps a 15% commission, so you receive 85%, paid out
            automatically on purchase.
          </li>
        </ul>
      </div>

      {profile?.status === 'active' && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-sm text-emerald-900">
          Active: {profile.account_name} ···{profile.account_number_last4}
        </div>
      )}

      <form onSubmit={onSave} className="space-y-3">
        <label className="block text-sm">
          <span className="text-slate-700 font-medium">Bank</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={bankCode}
            onChange={(e) => setBankCode(e.target.value)}
            required
          >
            <option value="">Select bank</option>
            {banks.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-700 font-medium">Account number</span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            inputMode="numeric"
            autoComplete="off"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 12))}
            placeholder="NUBAN account number"
            required
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-lantern-primary-fill px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? 'Saving…' : profile?.status === 'active' ? 'Update bank account' : 'Save bank account'}
        </button>
      </form>
    </section>
  );
}
