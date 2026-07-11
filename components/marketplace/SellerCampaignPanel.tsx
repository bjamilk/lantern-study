import React, { useState } from 'react';
import { sendSellerCampaign } from '../../services/supabase';
import type { SellerCustomerSegment } from '../../types';
import Button from '../ui/Button';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import Modal from '../ui/Modal';

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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Campaign failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabelledBy="seller-campaign-title"
      maxWidthClass="max-w-lg"
      loading={sending}
      closeOnBackdrop={!sending}
      alignClass="items-end sm:items-center justify-center"
      paddingClass="p-0 sm:p-4"
      panelClassName="!p-0 rounded-t-2xl sm:rounded-2xl border border-lantern-border"
    >
        <div className="flex items-center justify-between p-4 border-b border-lantern-border">
          <h2 id="seller-campaign-title" className="text-lg font-semibold text-lantern-text">Message customers</h2>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={sending}>Close</Button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-lantern-text-muted">
            Sends an in-app notification and DM to up to 25 customers (50/day max).
          </p>
          {!defaultBuyerIds?.length && (
            <Select value={segment} onChange={(e) => setSegment(e.target.value)} aria-label="Customer segment">
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
            aria-label="Campaign message"
          />
          {error && <p className="text-sm text-lantern-error">{error}</p>}
          {result && <p className="text-sm text-lantern-accent">{result}</p>}
          <Button onClick={() => void handleSend()} loading={sending} disabled={!message.trim()} className="w-full min-h-[44px]">
            Send campaign
          </Button>
        </div>
    </Modal>
  );
};

export default SellerCampaignPanel;
