import React, { useEffect, useState } from 'react';
import { createSellerCoupon, fetchSellerCoupons } from '../../services/supabase';
import type { MarketplaceCoupon } from '../../types';
import Button from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import Modal from '../ui/Modal';

interface SellerCouponsPanelProps {
  onClose: () => void;
}

const SellerCouponsPanel: React.FC<SellerCouponsPanelProps> = ({ onClose }) => {
  const [coupons, setCoupons] = useState<MarketplaceCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setCoupons(await fetchSellerCoupons());
    } catch {
      setCoupons([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCreate = async () => {
    setError('');
    const value = Number(discountValue);
    if (!code.trim() || !value || value <= 0) {
      setError('Enter a code and valid discount value.');
      return;
    }
    setSaving(true);
    try {
      await createSellerCoupon({
        code: code.trim(),
        discountType,
        discountValue: value,
        maxUses: maxUses ? Number(maxUses) : undefined,
      });
      setCode('');
      setDiscountValue('');
      setMaxUses('');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create coupon');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabelledBy="seller-coupons-title"
      maxWidthClass="max-w-lg"
      loading={saving}
      closeOnBackdrop={!saving}
      alignClass="items-end sm:items-center justify-center"
      paddingClass="p-0 sm:p-4"
      panelClassName="!p-0 rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto border border-lantern-border"
    >
        <div className="flex items-center justify-between p-4 border-b border-lantern-border">
          <h2 id="seller-coupons-title" className="text-lg font-semibold text-lantern-text">Seller coupons</h2>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>Close</Button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-sm text-lantern-text-muted">Buyers can apply these codes at checkout on your listings.</p>
          <div className="grid grid-cols-2 gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" aria-label="Coupon code" />
            <Select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
              aria-label="Discount type"
            >
              <option value="percent">Percent off</option>
              <option value="fixed">Fixed ₦ off</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder={discountType === 'percent' ? '10' : '500'}
              aria-label="Discount value"
            />
            <Input
              type="number"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="Max uses (optional)"
              aria-label="Maximum uses"
            />
          </div>
          {error && <p className="text-sm text-lantern-error">{error}</p>}
          <Button onClick={() => void handleCreate()} loading={saving} className="w-full min-h-[44px]">Create coupon</Button>
        </div>

        <div className="p-4 border-t border-lantern-border space-y-2">
          {loading && <p className="text-sm text-lantern-text-muted">Loading coupons...</p>}
          {!loading && coupons.length === 0 && (
            <p className="text-sm text-lantern-text-muted">No coupons yet.</p>
          )}
          {coupons.map((coupon) => (
            <div
              key={coupon.id}
              className="flex items-center justify-between p-3 rounded-lg bg-lantern-background-secondary border border-lantern-border"
            >
              <div>
                <p className="font-mono font-semibold text-lantern-text">{coupon.code}</p>
                <p className="text-xs text-lantern-text-muted">
                  {coupon.discount_type === 'percent'
                    ? `${coupon.discount_value}% off`
                    : `₦${Number(coupon.discount_value).toLocaleString()} off`}
                  {' · '}
                  {coupon.uses_count}
                  {coupon.max_uses != null ? `/${coupon.max_uses}` : ''} used
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${coupon.active ? 'bg-emerald-100 text-emerald-700' : 'bg-lantern-background-secondary text-lantern-text-secondary'}`}>
                {coupon.active ? 'Active' : 'Inactive'}
              </span>
            </div>
          ))}
        </div>
    </Modal>
  );
};

export default SellerCouponsPanel;
