import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ClassJoinPreview } from '@lantern/shared';
import { canonicalizeJoinCode, isValidJoinCode } from '@lantern/shared/academic';
import { Button, Card, Input, ScreenHeader } from '../ui';
import { joinClassByCode, previewClassByCode } from '../../services/classes';

interface JoinClassPageProps {
  code: string;
  onJoined?: () => void;
}

export const JoinClassPage: React.FC<JoinClassPageProps> = ({ code, onJoined }) => {
  const navigate = useNavigate();
  const [value, setValue] = useState(canonicalizeJoinCode(code));
  const [preview, setPreview] = useState<ClassJoinPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const normalised = canonicalizeJoinCode(code);
    setValue(normalised);
    if (!isValidJoinCode(normalised)) {
      setPreview(null);
      return;
    }
    previewClassByCode(normalised)
      .then(setPreview)
      .catch((err: Error) => setError(err.message || 'That code is not valid'));
  }, [code]);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      await joinClassByCode(canonicalizeJoinCode(value));
      if (onJoined) onJoined();
      else navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-lantern-background flex items-center justify-center p-4">
      <Card padding="lg" className="w-full max-w-md flex flex-col gap-4">
        <ScreenHeader title="Join a class" subtitle="Enter the code from your lecturer. You do not need Canvas or Google Classroom." />
        <label className="flex flex-col gap-1">
          <span className="text-caption text-lantern-text-secondary">Join code</span>
          <Input
            value={value}
            onChange={(event) => setValue(canonicalizeJoinCode(event.target.value))}
            className="font-mono tracking-widest uppercase"
            maxLength={8}
          />
        </label>
        {preview ? (
          <div>
            <p className="text-title font-semibold text-lantern-text">{preview.title}</p>
            <p className="text-caption text-lantern-text-secondary">
              {preview.course.code} · {preview.instructorName} · {preview.memberCount} already in
            </p>
          </div>
        ) : null}
        {error ? <p className="text-body text-lantern-error">{error}</p> : null}
        <Button type="button" onClick={() => void join()} disabled={busy || !isValidJoinCode(value)}>
          {busy ? 'Joining…' : 'Join class'}
        </Button>
      </Card>
    </div>
  );
};

export default JoinClassPage;
