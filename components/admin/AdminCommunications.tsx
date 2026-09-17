import React, { useState } from 'react';
import { sendAdminBulkNotifications, sendAdminNotification } from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { Caption, Heading } from '../ui/Text';
import { AdminPageHeader } from './AdminChrome';

interface AdminCommunicationsProps {
  onSent: (message: string) => void;
  onError: (message: string) => void;
}

export const AdminCommunications: React.FC<AdminCommunicationsProps> = ({ onSent, onError }) => {
  const [userId, setUserId] = useState('');
  const [userIdsRaw, setUserIdsRaw] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [type, setType] = useState('info');
  const [loading, setLoading] = useState(false);

  const sendSingle = async () => {
    if (!userId.trim() || !message.trim()) {
      onError('User ID and message are required.');
      return;
    }
    setLoading(true);
    try {
      await sendAdminNotification({ userId: userId.trim(), message: message.trim(), link: link.trim() || undefined, type });
      onSent('Notification sent.');
      setMessage('');
    } catch (err: any) {
      onError(err.message || 'Send failed');
    } finally {
      setLoading(false);
    }
  };

  const sendBulk = async () => {
    const userIds = userIdsRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!userIds.length || !message.trim()) {
      onError('At least one user ID and a message are required.');
      return;
    }
    setLoading(true);
    try {
      const delivered = await sendAdminBulkNotifications({ userIds, message: message.trim(), link: link.trim() || undefined, type });
      // Report what the server inserted, not what was requested — a partial
      // insert used to read as full success.
      if (delivered === userIds.length) {
        onSent(`Sent to ${delivered} user${delivered === 1 ? '' : 's'}.`);
      } else {
        onError(`Delivered ${delivered} of ${userIds.length} notifications.`);
      }
      setMessage('');
    } catch (err: any) {
      onError(err.message || 'Bulk send failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <AdminPageHeader
        eyebrow="Broadcast"
        title="Communications"
        description="Send an in-app notice to one student, or the same message to up to 100 IDs."
      />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="space-y-3" padding="md">
          <Heading className="text-lantern-text">Send to one user</Heading>
          <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User ID" />
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message" rows={4} />
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link (optional)" />
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-full">
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="success">Success</option>
          </Select>
          <Button loading={loading} onClick={sendSingle}>Send notification</Button>
        </Card>

        <Card className="space-y-3" padding="md">
          <Heading className="text-lantern-text">Bulk send (max 100)</Heading>
          <Textarea
            value={userIdsRaw}
            onChange={(e) => setUserIdsRaw(e.target.value)}
            placeholder="User IDs separated by commas or newlines"
            rows={4}
            className="font-mono"
          />
          <Caption className="text-lantern-text-muted">Uses the same message, link, and type from the left panel.</Caption>
          <Button variant="secondary" loading={loading} onClick={sendBulk}>Send bulk</Button>
        </Card>
      </div>
    </div>
  );
};
