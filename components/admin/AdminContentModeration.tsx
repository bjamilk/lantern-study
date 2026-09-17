import React, { useEffect, useState } from 'react';
import {
  AdminDeck,
  AdminGroup,
  AdminMessage,
  AdminOfflineBundle,
  deleteAdminMessage,
  fetchAdminDecks,
  fetchAdminGroups,
  fetchAdminMessages,
  fetchAdminOfflineSummary,
  removeAdminDeck,
  updateAdminGroup,
} from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Body, Caption } from '../ui/Text';
import { formatRelativeTime } from './types';
import { AdminEmpty, AdminPageHeader, AdminSegmented, AdminStatusBadge, AdminToolbar } from './AdminChrome';

interface AdminContentModerationProps {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export const AdminContentModeration: React.FC<AdminContentModerationProps> = ({ onError, onSuccess }) => {
  const [section, setSection] = useState<'groups' | 'messages' | 'decks' | 'offline'>('groups');
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [decks, setDecks] = useState<AdminDeck[]>([]);
  const [offline, setOffline] = useState<AdminOfflineBundle[]>([]);
  const [groupSearch, setGroupSearch] = useState('');
  const [deckSearch, setDeckSearch] = useState('');
  const [messageGroupId, setMessageGroupId] = useState('');
  const [offlineTotal, setOfflineTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      if (section === 'groups') {
        const res = await fetchAdminGroups({ search: groupSearch || undefined, limit: 30 });
        setGroups(res.data);
      } else if (section === 'messages') {
        const res = await fetchAdminMessages({ groupId: messageGroupId || undefined, limit: 30 });
        setMessages(res.data);
      } else if (section === 'decks') {
        const res = await fetchAdminDecks({ search: deckSearch || undefined, limit: 30 });
        setDecks(res.data);
      } else {
        const res = await fetchAdminOfflineSummary();
        setOffline(res.data);
        setOfflineTotal(res.pagination?.total ?? null);
      }
    } catch (err: any) {
      onError(err.message || 'Load failed');
      // Clear the failed section: leaving the previous section's rows on
      // screen under this section's header presented stale data as current.
      if (section === 'groups') setGroups([]);
      else if (section === 'messages') setMessages([]);
      else if (section === 'decks') setDecks([]);
      else setOffline([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [section]);

  return (
    <div className="space-y-4">
      <AdminPageHeader
        eyebrow="Library"
        title="Content"
        description="Archive groups, delete messages, remove decks, and inspect offline bundles."
        actions={
          <Button size="sm" variant="secondary" onClick={load} loading={loading}>
            Refresh
          </Button>
        }
      />

      <AdminSegmented
        ariaLabel="Content sections"
        value={section}
        onChange={setSection}
        options={[
          { id: 'groups', label: 'Groups' },
          { id: 'messages', label: 'Messages' },
          { id: 'decks', label: 'Decks' },
          { id: 'offline', label: 'Offline' },
        ]}
      />

      {section === 'groups' && (
        <Card className="space-y-3" padding="md">
          <AdminToolbar
            actions={
              <Button size="sm" onClick={load}>
                Search
              </Button>
            }
          >
            <Input
              value={groupSearch}
              onChange={(e) => setGroupSearch(e.target.value)}
              placeholder="Search groups"
              className="flex-1 min-w-[200px]"
            />
          </AdminToolbar>
          {groups.length ? (
            groups.map((g) => (
              <div key={g.id} className="flex justify-between items-center gap-3 border-b border-lantern-border last:border-0 py-3">
                <div className="min-w-0">
                  <Body className="font-semibold text-lantern-text">{g.name}</Body>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <AdminStatusBadge tone={g.is_archived ? 'neutral' : 'success'}>
                      {g.is_archived ? 'Archived' : 'Active'}
                    </AdminStatusBadge>
                    <Caption className="text-lantern-text-muted">{formatRelativeTime(g.created_at)}</Caption>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={g.is_archived ? 'secondary' : 'danger'}
                  onClick={async () => {
                    try {
                      await updateAdminGroup(g.id, !g.is_archived);
                      onSuccess(g.is_archived ? 'Group restored.' : 'Group archived.');
                      load();
                    } catch (err: any) {
                      onError(err.message);
                    }
                  }}
                >
                  {g.is_archived ? 'Restore' : 'Archive'}
                </Button>
              </div>
            ))
          ) : (
            <AdminEmpty>No groups found.</AdminEmpty>
          )}
        </Card>
      )}

      {section === 'messages' && (
        <Card className="space-y-3" padding="md">
          <AdminToolbar
            actions={
              <Button size="sm" onClick={load}>
                Load messages
              </Button>
            }
          >
            <Input
              value={messageGroupId}
              onChange={(e) => setMessageGroupId(e.target.value)}
              placeholder="Filter by group ID (optional)"
              className="font-mono flex-1 min-w-[200px]"
            />
          </AdminToolbar>
          {messages.length ? (
            messages.map((m) => (
              <div key={m.id} className="border-b border-lantern-border last:border-0 py-3 space-y-2">
                <Caption className="text-lantern-text-muted">
                  {m.sender?.name || m.sender_id} · {formatRelativeTime(m.timestamp)}
                </Caption>
                <Body className="text-lantern-text">{m.text || `[${m.type}]`}</Body>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    try {
                      await deleteAdminMessage(m.id);
                      onSuccess('Message deleted.');
                      load();
                    } catch (err: any) {
                      onError(err.message);
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            ))
          ) : (
            <AdminEmpty>No messages in this filter.</AdminEmpty>
          )}
        </Card>
      )}

      {section === 'decks' && (
        <Card className="space-y-3" padding="md">
          <AdminToolbar
            actions={
              <Button size="sm" onClick={load}>
                Search
              </Button>
            }
          >
            <Input
              value={deckSearch}
              onChange={(e) => setDeckSearch(e.target.value)}
              placeholder="Search decks"
              className="flex-1 min-w-[200px]"
            />
          </AdminToolbar>
          {decks.length ? (
            decks.map((d) => (
              <div key={d.id} className="flex justify-between items-center gap-3 border-b border-lantern-border last:border-0 py-3">
                <div className="min-w-0">
                  <Body className="font-semibold text-lantern-text">{d.name}</Body>
                  <Caption className="text-lantern-text-muted">
                    {d.owner?.name || d.user_id} · {d.card_count ?? 0} cards
                  </Caption>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    try {
                      await removeAdminDeck(d.id);
                      onSuccess('Deck removed.');
                      load();
                    } catch (err: any) {
                      onError(err.message);
                    }
                  }}
                >
                  Remove
                </Button>
              </div>
            ))
          ) : (
            <AdminEmpty>No decks found.</AdminEmpty>
          )}
        </Card>
      )}

      {section === 'offline' && (
        <Card className="space-y-3" padding="md">
          <Caption className="text-lantern-text-muted">
            Recent offline bundles (sync metadata only)
            {offlineTotal != null && offlineTotal > offline.length
              ? ` — showing ${offline.length} of ${offlineTotal}`
              : ''}
          </Caption>
          {offline.length ? (
            offline.map((b) => (
              <div key={b.id} className="border-b border-lantern-border last:border-0 py-3">
                {/* group_name is NOT NULL in the schema — a readable fallback,
                    where the raw bundle id was shown when display_name was unset. */}
                <Body className="font-semibold text-lantern-text">{b.display_name || b.group_name || b.id}</Body>
                <Caption className="text-lantern-text-muted">
                  {b.owner?.name || b.user_id} · updated {formatRelativeTime(b.updated_at || b.created_at)}
                </Caption>
              </div>
            ))
          ) : (
            <AdminEmpty>No offline bundles yet.</AdminEmpty>
          )}
        </Card>
      )}
    </div>
  );
};
