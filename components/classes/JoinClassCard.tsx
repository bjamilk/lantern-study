import React, { useState } from 'react';
import { canonicalizeJoinCode, isValidJoinCode } from '@lantern/shared/academic';
import { Button, Card, Input } from '../ui';
import { joinClassByCode } from '../../services/classes';

interface JoinClassCardProps {
  onJoined?: () => void;
}

export const JoinClassCard: React.FC<JoinClassCardProps> = ({ onJoined }) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  return (
    <Card padding="md">
      <form
        className="flex flex-col sm:flex-row gap-2 sm:items-end"
        onSubmit={async (event) => {
          event.preventDefault();
          const normalised = canonicalizeJoinCode(code);
          if (!isValidJoinCode(normalised)) {
            setError('Enter the 6-character code from your lecturer');
            return;
          }
          setBusy(true);
          setError(null);
          try {
            const joined = await joinClassByCode(normalised);
            setDone(joined.title);
            setCode('');
            onJoined?.();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not join');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-caption font-medium text-lantern-text">Join a class</span>
          <Input
            value={code}
            onChange={(event) => setCode(canonicalizeJoinCode(event.target.value))}
            placeholder="ABC234"
            className="font-mono tracking-widest uppercase"
            maxLength={8}
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? 'Joining…' : 'Join'}
        </Button>
      </form>
      {error ? <p className="text-caption text-lantern-error mt-2">{error}</p> : null}
      {done ? (
        <p className="text-caption text-lantern-text-secondary mt-2">You joined {done}.</p>
      ) : null}
    </Card>
  );
};
