import React, { useEffect, useState } from 'react';
import { acceptNoteShareLink, previewNoteShareLink } from '../services/notes';
import { navigateToPath } from '../utils/appNavigation';
import { NOTE_SHARE_STORAGE_KEY } from '../hooks/useNoteShareLink';
import { AppIcon } from './ui/AppIcon';

interface NoteShareAcceptScreenProps {
  token: string;
}

const NoteShareAcceptScreen: React.FC<NoteShareAcceptScreenProps> = ({ token }) => {
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    noteId?: string;
    id?: string;
    title?: string;
    noteTitle?: string;
    role?: 'viewer' | 'editor';
    permission?: 'viewer' | 'editor';
    owner?: { name?: string; username?: string };
    ownerName?: string;
    alreadyAccepted?: boolean;
    alreadyHasAccess?: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void previewNoteShareLink(token)
      .then((data) => !cancelled && setPreview(data))
      .catch((err: Error) => !cancelled && setError(err.message || 'Invalid or expired note link.'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [token]);

  const close = () => {
    localStorage.removeItem(NOTE_SHARE_STORAGE_KEY);
    navigateToPath('/dashboard', { replace: true });
  };

  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const accepted = await acceptNoteShareLink(token) as { noteId?: string; note?: { id?: string } };
      const noteId = accepted.noteId || accepted.note?.id || preview?.noteId || preview?.id;
      localStorage.removeItem(NOTE_SHARE_STORAGE_KEY);
      navigateToPath(noteId ? `/notes/${encodeURIComponent(noteId)}` : '/notes', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not accept this note share.');
    } finally {
      setAccepting(false);
    }
  };

  const title = preview?.title || preview?.noteTitle || 'Shared note';
  const permission = preview?.role || preview?.permission || 'viewer';
  const owner = preview?.owner?.name || preview?.owner?.username || preview?.ownerName;

  return (
    <div className="min-h-screen flex items-center justify-center bg-lantern-background p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-lantern-border bg-lantern-surface shadow-xl">
        <div className="bg-gradient-to-r from-lantern-primary to-purple-600 px-6 py-4">
          <h1 className="text-lg font-bold text-white">Note invitation</h1>
          <p className="text-sm text-white/80">Review access before accepting</p>
        </div>
        <div className="p-6">
          {loading && <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-lantern-primary/30 border-t-lantern-primary" />}
          {!loading && error && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <button type="button" onClick={close} className="rounded-lg bg-lantern-background-secondary px-4 py-2 text-sm font-medium text-lantern-text">Go to dashboard</button>
            </div>
          )}
          {!loading && preview && !error && (
            <div className="space-y-6 text-center">
              <AppIcon name="document-text" size={64} className="mx-auto text-lantern-primary" />
              <div>
                <h2 className="text-xl font-semibold text-lantern-text">{title}</h2>
                {owner && <p className="mt-1 text-sm text-lantern-text-secondary">Shared by {owner}</p>}
                <p className="mt-3 text-sm text-lantern-text-secondary">You’ll have <span className="font-semibold capitalize text-lantern-text">{permission}</span> access.</p>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={close} disabled={accepting} className="flex-1 rounded-xl border border-lantern-border py-3 font-semibold text-lantern-text">
                  <AppIcon name="close" size={20} className="mr-1 inline" />Decline
                </button>
                <button type="button" onClick={() => void accept()} disabled={accepting} className="flex-1 rounded-xl bg-lantern-primary py-3 font-semibold text-white disabled:opacity-50">
                  <AppIcon name="checkmark" size={20} className="mr-1 inline" />{accepting ? 'Accepting…' : (preview.alreadyAccepted || preview.alreadyHasAccess) ? 'Open note' : 'Accept'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NoteShareAcceptScreen;
