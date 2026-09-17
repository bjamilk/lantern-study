import React from 'react';
import {
  AdminListing,
  AdminMarketplaceOrder,
  AdminPagination,
} from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { Body, Caption } from '../ui/Text';
import { PaginationBar } from './PaginationBar';
import { AdminAppeals } from './AdminAppeals';
import {
  AdminEmpty,
  AdminPageHeader,
  AdminRowActions,
  AdminSegmented,
  AdminStatusBadge,
  AdminTable,
  AdminToolbar,
  adminCellClass,
  adminRowClass,
} from './AdminChrome';
import { exportCsv, formatDate, formatRelativeTime } from './types';

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

function listingTone(status: string) {
  if (status === 'active') return 'success' as const;
  if (status === 'suspended_by_admin') return 'warning' as const;
  if (status === 'removed_by_admin') return 'danger' as const;
  return 'neutral' as const;
}

function orderTone(status: string) {
  if (status === 'disputed') return 'warning' as const;
  if (status === 'completed') return 'success' as const;
  if (status === 'cancelled') return 'danger' as const;
  return 'neutral' as const;
}

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
    <div className="space-y-4">
      <AdminPageHeader
        eyebrow="Campus shop"
        title="Marketplace"
        description="Listings, order disputes, and seller appeals of takedowns."
      />

      <AdminSegmented
        ariaLabel="Marketplace views"
        value={view}
        onChange={onViewChange}
        options={[
          { id: 'listings', label: 'Listings' },
          { id: 'orders', label: 'Orders & disputes', badge: disputedCount },
          { id: 'appeals', label: 'Takedown appeals' },
        ]}
      />

      {view === 'appeals' ? (
        <AdminAppeals onSuccess={onSuccess} onError={onError} />
      ) : view === 'listings' ? (
        <Card className="space-y-4">
          <AdminToolbar
            actions={
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
            }
          >
            <Select
              value={listingStatusFilter}
              onChange={(e) => onListingStatusFilterChange(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended_by_admin">Suspended</option>
              <option value="removed_by_admin">Removed</option>
            </Select>
          </AdminToolbar>
          {listings.length ? (
            <AdminTable headers={['Title', 'Seller', 'Status', 'Created', 'Actions']}>
              {listings.map((listing) => (
                <tr key={listing.id} className={adminRowClass}>
                  <td className={adminCellClass}>{listing.title}</td>
                  <td className={`${adminCellClass} text-lantern-text-muted`}>
                    {listing.seller?.name || listing.user_id.slice(0, 8)}
                  </td>
                  <td className={adminCellClass}>
                    <AdminStatusBadge tone={listingTone(listing.status)}>
                      {listing.status.replace(/_/g, ' ')}
                    </AdminStatusBadge>
                  </td>
                  <td className={adminCellClass}>{formatDate(listing.created_at)}</td>
                  <td className={`${adminCellClass} whitespace-nowrap`}>
                    <AdminRowActions>
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
                    </AdminRowActions>
                  </td>
                </tr>
              ))}
            </AdminTable>
          ) : (
            <AdminEmpty>No listings match this filter.</AdminEmpty>
          )}
          <PaginationBar pagination={listingsPagination} onPrev={onListingsPrev} onNext={onListingsNext} />
        </Card>
      ) : (
        <Card className="space-y-4">
          <AdminToolbar
            actions={
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
            }
          >
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
          </AdminToolbar>

          {orderStatusFilter === 'disputed' ? (
            <Caption className="text-lantern-text-muted">
              Resolve marketplace order disputes by forcing a payout to the seller (complete sale) or
              refunding the buyer (cancel order and re-list the item). Legacy offline orders
              still use the soft settlement path.
            </Caption>
          ) : null}

          <div className="space-y-3">
            {orders.map((order) => {
              const isDisputed = order.status === 'disputed';
              return (
                <div
                  key={order.id}
                  className="rounded-lantern border border-lantern-border p-4 space-y-3 bg-lantern-surface"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Body className="font-semibold text-lantern-text">
                        {order.listing?.title || order.listing_id.slice(0, 8)}
                      </Body>
                      <Caption className="text-lantern-text-muted mt-0.5">
                        Buyer: {order.buyer?.name || order.buyer_id.slice(0, 8)} · Seller:{' '}
                        {order.seller?.name || order.seller_id.slice(0, 8)}
                      </Caption>
                    </div>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <AdminStatusBadge tone={orderTone(order.status)}>
                        {ORDER_STATUS_LABELS[order.status] || order.status}
                      </AdminStatusBadge>
                      <AdminStatusBadge tone="accent">
                        ₦{Number(order.amount).toLocaleString()}
                      </AdminStatusBadge>
                    </div>
                  </div>

                  <Caption className="text-lantern-text-muted">
                    Order {order.id.slice(0, 8)}… · {order.source.replace(/_/g, ' ')} · Settlement:{' '}
                    {order.transaction?.status || 'none'} · Updated {formatRelativeTime(order.updated_at)}
                  </Caption>

                  {isDisputed ? (
                    <div className="space-y-2 pt-1 border-t border-lantern-border">
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
              <AdminEmpty>
                {orderStatusFilter === 'disputed'
                  ? 'No open disputes — great news.'
                  : 'No orders match this filter.'}
              </AdminEmpty>
            ) : null}
          </div>

          <PaginationBar pagination={ordersPagination} onPrev={onOrdersPrev} onNext={onOrdersNext} />
        </Card>
      )}
    </div>
  );
};
