import React, { useEffect, useState } from 'react';
import { createSellerCoupon, fetchSellerCoupons } from '../../services/supabase';
import type { MarketplaceCoupon } from '../../types';
import Button from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

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
    } catch (e: any) {
      setError(e?.message || 'Failed to create coupon');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold">Seller coupons</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-sm text-slate-500">Buyers can apply these codes at checkout on your listings.</p>
          <div className="grid grid-cols-2 gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" />
            <Select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
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
            />
            <Input
              type="number"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="Max uses (optional)"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button onClick={handleCreate} loading={saving} className="w-full">Create coupon</Button>
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-700 space-y-2">
          {loading && <p className="text-sm text-slate-500">Loading coupons...</p>}
          {!loading && coupons.length === 0 && (
            <p className="text-sm text-slate-500">No coupons yet.</p>
          )}
          {coupons.map((coupon) => (
            <div
              key={coupon.id}
              className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            >
              <div>
                <p className="font-mono font-semibold">{coupon.code}</p>
                <p className="text-xs text-slate-500">
                  {coupon.discount_type === 'percent'
                    ? `${coupon.discount_value}% off`
                    : `₦${Number(coupon.discount_value).toLocaleString()} off`}
                  {' · '}
                  {coupon.uses_count}
                  {coupon.max_uses != null ? `/${coupon.max_uses}` : ''} used
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${coupon.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                {coupon.active ? 'Active' : 'Inactive'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SellerCouponsPanel;
