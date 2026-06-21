import React from 'react';
import { AdminUser } from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { PaginationBar } from './PaginationBar';
import { AdminPagination } from '../../services/admin';
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
}) => (
  <Card className="space-y-3">
    <div className="flex flex-wrap gap-2 items-center justify-between">
      <Input
        value={userSearch}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search name, username, email, or user ID"
        className="flex-1 min-w-[220px]"
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => exportCsv('admin-users.csv', usersToCsvRows(users))}
        disabled={!users.length}
      >
        Export CSV
      </Button>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-lantern-text-muted border-b border-lantern-border">
            <th className="py-2 pr-2">User</th>
            <th className="py-2 pr-2">Email</th>
            <th className="py-2 pr-2">Joined</th>
            <th className="py-2 pr-2">Status</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-lantern-border/60">
              <td className="py-2 pr-2">
                <button type="button" className="text-lantern-primary hover:underline text-left" onClick={() => onSelectUser(user.id)}>
                  {user.name || user.username || user.id.slice(0, 8)}
                </button>
              </td>
              <td className="py-2 pr-2 text-lantern-text-muted">{user.email || '-'}</td>
              <td className="py-2 pr-2">{formatDate(user.created_at)}</td>
              <td className="py-2 pr-2">{user.is_banned ? 'Banned' : 'Active'}{user.is_platform_admin ? ' · Admin' : ''}</td>
              <td className="py-2 flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => onSelectUser(user.id)}>Details</Button>
                <Button
                  size="sm"
                  variant={user.is_banned ? 'secondary' : 'danger'}
                  loading={actionLoading[`ban:${user.id}`]}
                  onClick={() => onToggleBan(user)}
                >
                  {user.is_banned ? 'Unban' : 'Ban'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={actionLoading[`role:${user.id}`]}
                  onClick={() => onToggleAdmin(user)}
                >
                  {user.is_platform_admin ? 'Revoke admin' : 'Make admin'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <PaginationBar pagination={pagination} onPrev={onPrev} onNext={onNext} />
  </Card>
);
