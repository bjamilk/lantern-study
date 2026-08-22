import React from 'react';
import {
  AdminListing,
  AdminMarketplaceOrder,
  AdminPagination,
} from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Select } from '../ui/Select';
import { StatPill } from '../ui/StatPill';
import { Textarea } from '../ui/Textarea';
import { PaginationBar } from './PaginationBar';
import { AdminAppeals } from './AdminAppeals';
import { exportCsv, formatDate, formatDateTime } from './types';

export type AdminMarketplaceView = 'listings' | 'orders' | 'appeals';

interface AdminMarketplaceProps {
  view: AdminMarketplaceView;
  onViewChange: (view: AdminMarketplaceView) => void;
  /** Appeals tab reports its own outcomes through the shell banners. */
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  listings: AdminListing[];
  listingsPagination: AdminPagination | null;
  listingStatusFilter: string;
  onListingStatusFilterChange: (value: string) => void;
  onListingsPrev: () => void;
  onListingsNext: () => void;
  onRemove: (id: string) => void;
  onToggleSuspend: (listing: AdminListing) => void;
  orders: AdminMarketplaceOrder[];
  ordersPagination: AdminPagination | null;
  orderStatusFilter: string;
  orderNotes: Record<string, string>;
  onOrderStatusFilterChange: (value: string) => void;
  onOrdersPrev: () => void;
  onOrdersNext: () => void;
  onOrderNoteChange: (orderId: string, note: string) => void;
  onResolveDispute: (
    orderId: string,
    resolution: 'release_to_seller' | 'refund_buyer'
  ) => void;
  disputedOrdersTotal?: number;
  actionLoading: Record<string, boolean>;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Pending payment',
  paid: 'Paid',
  ready_for_pickup: 'Ready for pickup or delivery',
  buyer_confirmed: 'Buyer confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
};

export const AdminMarketplace: React.FC<AdminMarketplaceProps> = ({
  view,
  onViewChange,
  listings,
  listingsPagination,
  listingStatusFilter,
  onListingStatusFilterChange,
  onListingsPrev,
  onListingsNext,
  onRemove,
  onToggleSuspend,
  orders,
  ordersPagination,
  orderStatusFilter,
  orderNotes,
  onOrderStatusFilterChange,
  onOrdersPrev,
  onOrdersNext,
  onOrderNoteChange,
  onResolveDispute,
  disputedOrdersTotal = 0,
  actionLoading,
  onSuccess,
  onError,
}) => {
  const disputedCount =
    orderStatusFilter === 'disputed' ? ordersPagination?.total ?? orders.length : disputedOrdersTotal;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={view === 'listings' ? 'primary' : 'ghost'}
          onClick={() => onViewChange('listings')}
        >
          Listings
        </Button>
        <Button
          size="sm"
          variant={view === 'orders' ? 'primary' : 'ghost'}
          onClick={() => onViewChange('orders')}
        >
          Orders & disputes
          {disputedCount > 0 ? (
            <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
              {disputedCount}
            </span>
          ) : null}
        </Button>
        <Button
          size="sm"
          variant={view === 'appeals' ? 'primary' : 'ghost'}
          onClick={() => onViewChange('appeals')}
        >
          Takedown appeals
        </Button>
      </div>

      {view === 'appeals' ? (
        <AdminAppeals onSuccess={onSuccess} onError={onError} />
      ) : view === 'listings' ? (
  <Card className="space-y-3">
    <div className="flex flex-wrap gap-2 justify-between">
            <Select
              value={listingStatusFilter}
              onChange={(e) => onListingStatusFilterChange(e.target.value)}
      >
        <option value="all">All statuses</option>
        <option value="active">Active</option>
        <option value="suspended_by_admin">Suspended</option>
        <option value="removed_by_admin">Removed</option>
            </Select>
      <Button
        variant="secondary"
        size="sm"
        disabled={!listings.length}
        onClick={() =>
          exportCsv(
            'admin-listings.csv',
            listings.map((l) => ({
              id: l.id,
              title: l.title,
              price: l.price,
              status: l.status,
              seller: l.seller?.name || l.user_id,
              created: l.created_at,
            }))
          )
        }
      >
        Export CSV
      </Button>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-lantern-text-muted border-b border-lantern-border">
            <th className="py-2">Title</th>
            <th className="py-2">Seller</th>
            <th className="py-2">Status</th>
            <th className="py-2">Created</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {listings.map((listing) => (
            <tr key={listing.id} className="border-b border-lantern-border/60">
              <td className="py-2 pr-2">{listing.title}</td>
              <td className="py-2 pr-2">{listing.seller?.name || listing.user_id.slice(0, 8)}</td>
              <td className="py-2 pr-2">{listing.status}</td>
              <td className="py-2 pr-2">{formatDate(listing.created_at)}</td>
              <td className="py-2 flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={actionLoading[`suspend:${listing.id}`]}
                        onClick={() => onToggleSuspend(listing)}
                      >
                  {listing.status === 'suspended_by_admin' ? 'Restore' : 'Suspend'}
                </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={actionLoading[`remove:${listing.id}`]}
                        onClick={() => onRemove(listing.id)}
                      >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
          <PaginationBar pagination={listingsPagination} onPrev={onListingsPrev} onNext={onListingsNext} />
        </Card>
      ) : (
        <Card className="space-y-3">
          <div className="flex flex-wrap gap-2 justify-between items-center">
            <Select
              value={orderStatusFilter}
              onChange={(e) => onOrderStatusFilterChange(e.target.value)}
            >
              <option value="disputed">Open disputes</option>
              <option value="all">All orders</option>
              <option value="pending_payment">Pending payment</option>
              <option value="paid">Paid</option>
              <option value="ready_for_pickup">Ready for pickup or delivery</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
            <Button
              variant="secondary"
              size="sm"
              disabled={!orders.length}
              onClick={() =>
                exportCsv(
                  'admin-marketplace-orders.csv',
                  orders.map((o) => ({
                    id: o.id,
                    listing: o.listing?.title || o.listing_id,
                    buyer: o.buyer?.name || o.buyer_id,
                    seller: o.seller?.name || o.seller_id,
                    amount: o.amount,
                    status: o.status,
                    payout_or_refund: o.transaction?.status || '',
                    updated: o.updated_at,
                  }))
                )
              }
            >
              Export CSV
            </Button>
          </div>

          {orderStatusFilter === 'disputed' ? (
            <p className="text-sm text-lantern-text-muted">
              Resolve marketplace order disputes by forcing a payout to the seller (complete sale) or
              refunding the buyer (cancel order and re-list the item). Legacy offline orders
              still use the soft settlement path.
            </p>
          ) : null}

          <div className="space-y-3">
            {orders.map((order) => {
              const isDisputed = order.status === 'disputed';
              return (
                <div
                  key={order.id}
                  className="rounded-lg border border-lantern-border p-3 space-y-2 bg-lantern-surface/40"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-lantern-text">
                        {order.listing?.title || order.listing_id.slice(0, 8)}
                      </p>
                      <p className="text-xs text-lantern-text-muted mt-0.5">
                        Buyer: {order.buyer?.name || order.buyer_id.slice(0, 8)} · Seller:{' '}
                        {order.seller?.name || order.seller_id.slice(0, 8)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <StatPill
                        label="Status"
                        value={ORDER_STATUS_LABELS[order.status] || order.status}
                        accent={isDisputed ? 'warning' : order.status === 'completed' ? 'success' : 'primary'}
                      />
                      <StatPill label="Amount" value={`₦${Number(order.amount).toLocaleString()}`} accent="primary" />
                    </div>
                  </div>

                  <div className="text-xs text-lantern-text-muted flex flex-wrap gap-x-4 gap-y-1">
                    <span>Order {order.id.slice(0, 8)}…</span>
                    <span>Source: {order.source.replace(/_/g, ' ')}</span>
                    <span>Settlement: {order.transaction?.status || 'none'}</span>
                    <span>Updated {formatDateTime(order.updated_at)}</span>
                  </div>

                  {isDisputed ? (
                    <div className="space-y-2 pt-1 border-t border-lantern-border/60">
                      <Textarea
                        value={orderNotes[order.id] || ''}
                        onChange={(e) => onOrderNoteChange(order.id, e.target.value)}
                        placeholder="Resolution note (optional — sent to buyer and seller)"
                        rows={2}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          loading={actionLoading[`dispute:${order.id}:release_to_seller`]}
                          onClick={() => onResolveDispute(order.id, 'release_to_seller')}
                        >
                          Force payout to seller
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={actionLoading[`dispute:${order.id}:refund_buyer`]}
                          onClick={() => onResolveDispute(order.id, 'refund_buyer')}
                        >
                          Refund buyer
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!orders.length ? (
              <p className="text-sm text-lantern-text-muted py-4 text-center">
                {orderStatusFilter === 'disputed'
                  ? 'No open disputes — great news.'
                  : 'No orders match this filter.'}
              </p>
            ) : null}
          </div>

          <PaginationBar pagination={ordersPagination} onPrev={onOrdersPrev} onNext={onOrdersNext} />
  </Card>
      )}
    </div>
);
};
