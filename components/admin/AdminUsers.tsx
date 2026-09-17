import React from 'react';
import { AdminUser } from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Skeleton } from '../ui/Skeleton';
import { Caption } from '../ui/Text';
import { PaginationBar } from './PaginationBar';
import { AdminPagination } from '../../services/admin';
import {
  AdminEmpty,
  AdminPageHeader,
  AdminRowActions,
  AdminStatusBadge,
  AdminTable,
  adminCellClass,
  adminRowClass,
} from './AdminChrome';
import { formatDate, usersToCsvRows, exportCsv } from './types';

interface AdminUsersProps {
  users: AdminUser[];
  pagination: AdminPagination | null;
  userSearch: string;
  actionLoading: Record<string, boolean>;
  onSearchChange: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onSelectUser: (userId: string) => void;
  onToggleBan: (user: AdminUser, reason?: string) => void;
  onToggleAdmin: (user: AdminUser) => void;
  loading?: boolean;
  /**
   * From the server. Undefined means "not loaded yet" and must not disable the
   * button — only an explicit false does, so a slow stats call never looks
   * like a withdrawn permission.
   */
  roleManagementEnabled?: boolean;
}

export const AdminUsers: React.FC<AdminUsersProps> = ({
  users,
  pagination,
  userSearch,
  actionLoading,
  onSearchChange,
  onPrev,
  onNext,
  onSelectUser,
  onToggleBan,
  onToggleAdmin,
  roleManagementEnabled,
  loading = false,
}) => {
  const roleDisabled = roleManagementEnabled === false;
  const roleHint = roleDisabled
    ? 'Role management is switched off on the server (ENABLE_ADMIN_ROLE_MANAGEMENT=false).'
    : undefined;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        eyebrow="People"
        title="Users"
        description="Search accounts, open a profile, ban, or change platform-admin access."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => exportCsv('admin-users.csv', usersToCsvRows(users))}
            disabled={!users.length}
          >
            Export CSV
          </Button>
        }
      />

      <Card className="space-y-4">
        <Input
          value={userSearch}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search name, username, email, or user ID"
        />

        {loading && !users.length ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading users">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : users.length ? (
          <AdminTable headers={['User', 'Email', 'Joined', 'Status', 'Actions']}>
            {users.map((user) => (
              <tr key={user.id} className={adminRowClass}>
                <td className={adminCellClass}>
                  <button
                    type="button"
                    className="font-semibold text-lantern-text hover:underline text-left"
                    onClick={() => onSelectUser(user.id)}
                  >
                    {user.name || user.username || user.id.slice(0, 8)}
                  </button>
                </td>
                <td className={`${adminCellClass} text-lantern-text-muted`}>{user.email || '—'}</td>
                <td className={adminCellClass}>{formatDate(user.created_at)}</td>
                <td className={adminCellClass}>
                  <div className="flex flex-wrap gap-1">
                    <AdminStatusBadge tone={user.is_banned ? 'danger' : 'success'}>
                      {user.is_banned ? 'Banned' : 'Active'}
                    </AdminStatusBadge>
                    {user.is_platform_admin ? <AdminStatusBadge tone="accent">Admin</AdminStatusBadge> : null}
                  </div>
                </td>
                <td className={`${adminCellClass} whitespace-nowrap`}>
                  <AdminRowActions>
                    <Button size="sm" variant="ghost" onClick={() => onSelectUser(user.id)}>
                      Details
                    </Button>
                    <Button
                      size="sm"
                      variant={user.is_banned ? 'secondary' : 'danger'}
                      loading={actionLoading[`ban:${user.id}`]}
                      onClick={() => onToggleBan(user)}
                    >
                      {user.is_banned ? 'Unban' : 'Ban'}
                    </Button>
                    <span title={roleHint}>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={roleDisabled}
                        loading={actionLoading[`role:${user.id}`]}
                        onClick={() => onToggleAdmin(user)}
                      >
                        {user.is_platform_admin ? 'Revoke admin' : 'Make admin'}
                      </Button>
                    </span>
                  </AdminRowActions>
                </td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <AdminEmpty>No users match this search.</AdminEmpty>
        )}

        {roleDisabled ? <Caption className="text-lantern-text-muted">{roleHint}</Caption> : null}
        <PaginationBar pagination={pagination} onPrev={onPrev} onNext={onNext} />
      </Card>
    </div>
  );
};
