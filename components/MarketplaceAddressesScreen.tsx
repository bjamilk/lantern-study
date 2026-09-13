import React, { useEffect, useState } from 'react';
import type { MarketplaceAddress } from '@lantern/shared/types';
import { formatMarketplaceAddressLine } from '@lantern/shared/marketplace';
import {
  createMarketplaceAddress,
  deleteMarketplaceAddress,
  fetchMarketplaceAddresses,
} from '../services/supabase';
import { useToastStore } from '../stores/toastStore';
import { AppIcon } from './ui/AppIcon';
import Button from './ui/Button';

export default function MarketplaceAddressesScreen({
  onBack,
}: {
  onBack: () => void;
}) {
  const showToast = useToastStore((s) => s.showToast);
  const [rows, setRows] = useState<MarketplaceAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [recipient_name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [line1, setLine1] = useState('');
  const [hall, setHall] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await fetchMarketplaceAddresses());
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await createMarketplaceAddress({
        recipient_name,
        phone,
        city,
        line1,
        hall,
        is_default: rows.length === 0,
      });
      setName('');
      setPhone('');
      setCity('');
      setLine1('');
      setHall('');
      await load();
    } catch (error: any) {
      showToast(error?.message || 'Could not save address', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-lantern-background">
      <div className="flex items-center gap-3 px-4 md:px-6 py-4 border-b border-lantern-border bg-lantern-surface">
        <button type="button" onClick={onBack} className="p-2 rounded-lg hover:bg-lantern-background-secondary" aria-label="Back">
          <AppIcon name="arrow-back" size={20} />
        </button>
        <h1 className="text-title text-lantern-text">Addresses</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 space-y-6">
        <p className="text-caption text-lantern-text-secondary">
          Bumpa-style: we save the address. The seller finds a rider. Lantern is not the courier.
        </p>
        {loading ? <p className="text-body text-lantern-text-secondary">Loading…</p> : null}
        {rows.map((row) => (
          <div key={row.id} className="p-4 rounded-2xl border border-lantern-border bg-lantern-surface">
            <p className="text-body font-medium text-lantern-text">{row.recipient_name}</p>
            <p className="text-caption text-lantern-text-secondary mt-1">
              {formatMarketplaceAddressLine(row)} · {row.phone}
            </p>
            <button
              type="button"
              className="mt-2 text-caption text-lantern-error"
              onClick={() => void deleteMarketplaceAddress(row.id).then(load)}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="space-y-3 p-4 rounded-2xl border border-lantern-border bg-lantern-surface">
          <h2 className="text-heading text-lantern-text">Add an address</h2>
          <input className="w-full min-h-[44px] px-3 rounded-xl border border-lantern-border bg-lantern-background text-body" placeholder="Recipient name" value={recipient_name} onChange={(e) => setName(e.target.value)} />
          <input className="w-full min-h-[44px] px-3 rounded-xl border border-lantern-border bg-lantern-background text-body" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input className="w-full min-h-[44px] px-3 rounded-xl border border-lantern-border bg-lantern-background text-body" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
          <input className="w-full min-h-[44px] px-3 rounded-xl border border-lantern-border bg-lantern-background text-body" placeholder="Street or room" value={line1} onChange={(e) => setLine1(e.target.value)} />
          <input className="w-full min-h-[44px] px-3 rounded-xl border border-lantern-border bg-lantern-background text-body" placeholder="Hall (optional)" value={hall} onChange={(e) => setHall(e.target.value)} />
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save address'}
          </Button>
        </div>
      </div>
    </div>
  );
}
