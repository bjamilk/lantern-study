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
import { formatDateTime } from './types';

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
        setOffline(await fetchAdminOfflineSummary());
      }
    } catch (err: any) {
      onError(err.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [section]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['groups', 'messages', 'decks', 'offline'] as const).map((s) => (
          <Button key={s} size="sm" variant={section === s ? 'primary' : 'ghost'} onClick={() => setSection(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
        <Button size="sm" variant="secondary" onClick={load} loading={loading}>
          Refresh
        </Button>
      </div>

      {section === 'groups' && (
        <Card className="space-y-3">
          <Input value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} placeholder="Search groups" />
          <Button size="sm" onClick={load}>Search</Button>
          {groups.map((g) => (
            <div key={g.id} className="flex justify-between items-center border-b border-lantern-border pb-2 text-sm">
              <div>
                <p className="font-medium">{g.name}</p>
                <p className="text-xs text-lantern-text-muted">{g.is_archived ? 'Archived' : 'Active'} · {formatDateTime(g.created_at)}</p>
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
          ))}
        </Card>
      )}

      {section === 'messages' && (
        <Card className="space-y-3">
          <Input value={messageGroupId} onChange={(e) => setMessageGroupId(e.target.value)} placeholder="Filter by group ID (optional)" className="font-mono" />
          <Button size="sm" onClick={load}>Load messages</Button>
          {messages.map((m) => (
            <div key={m.id} className="border-b border-lantern-border pb-2 text-sm">
              <p className="text-xs text-lantern-text-muted">{m.sender?.name || m.sender_id} · {formatDateTime(m.timestamp)}</p>
              <p className="text-lantern-text">{m.text || `[${m.type}]`}</p>
              <Button
                size="sm"
                variant="danger"
                className="mt-1"
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
          ))}
        </Card>
      )}

      {section === 'decks' && (
        <Card className="space-y-3">
          <Input value={deckSearch} onChange={(e) => setDeckSearch(e.target.value)} placeholder="Search decks" />
          <Button size="sm" onClick={load}>Search</Button>
          {decks.map((d) => (
            <div key={d.id} className="flex justify-between items-center border-b border-lantern-border pb-2 text-sm">
              <div>
                <p className="font-medium">{d.name}</p>
                <p className="text-xs text-lantern-text-muted">{d.owner?.name || d.user_id} · {d.card_count ?? 0} cards</p>
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
          ))}
        </Card>
      )}

      {section === 'offline' && (
        <Card className="space-y-2">
          <p className="text-sm text-lantern-text-muted">Recent offline bundles (sync metadata only)</p>
          {offline.map((b) => (
            <div key={b.id} className="text-sm border-b border-lantern-border pb-2">
              <p className="font-medium">{b.display_name || b.id}</p>
              <p className="text-xs text-lantern-text-muted">{b.owner?.name || b.user_id} · updated {formatDateTime(b.updated_at || b.created_at)}</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
};
