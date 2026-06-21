import React, { useState } from 'react';
import { sendSellerCampaign } from '../../services/supabase';
import type { SellerCustomerSegment } from '../../types';
import Button from '../ui/Button';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';

const SEGMENTS: Array<{ id: SellerCustomerSegment | ''; label: string }> = [
  { id: '', label: 'All customers' },
  { id: 'repeat_buyer', label: 'Repeat buyers' },
  { id: 'top_spender', label: 'Top spenders' },
  { id: 'open_order', label: 'Open orders' },
  { id: 'open_inquiry', label: 'Open inquiries' },
  { id: 'lead', label: 'Leads (no purchase yet)' },
];

interface SellerCampaignPanelProps {
  onClose: () => void;
  defaultBuyerIds?: string[];
}

const SellerCampaignPanel: React.FC<SellerCampaignPanelProps> = ({
  onClose,
  defaultBuyerIds,
}) => {
  const [segment, setSegment] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleSend = async () => {
    setError('');
    setResult(null);
    setSending(true);
    try {
      const data = await sendSellerCampaign({
        message,
        segment: segment || undefined,
        buyerIds: defaultBuyerIds,
      });
      setResult(`Sent to ${data.sent} customer${data.sent === 1 ? '' : 's'}${data.skipped ? ` (${data.skipped} skipped)` : ''}.`);
      setMessage('');
    } catch (e: any) {
      setError(e?.message || 'Campaign failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold">Message customers</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-slate-500">
            Sends an in-app notification and DM to up to 25 customers (50/day max).
          </p>
          {!defaultBuyerIds?.length && (
            <Select value={segment} onChange={(e) => setSegment(e.target.value)}>
              {SEGMENTS.map((s) => (
                <option key={s.id || 'all'} value={s.id}>{s.label}</option>
              ))}
            </Select>
          )}
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="New arrivals, price drops, exam-season bundles..."
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {result && <p className="text-sm text-emerald-600">{result}</p>}
          <Button onClick={handleSend} loading={sending} disabled={!message.trim()} className="w-full">
            Send campaign
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SellerCampaignPanel;
