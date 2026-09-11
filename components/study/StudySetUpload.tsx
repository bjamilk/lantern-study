import React, { useMemo, useState } from 'react';
import { useAiJobStore } from '../../stores/aiJobStore';
import { Button, Card } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useToastStore } from '../../stores/toastStore';

type JobFilter = 'all' | 'processing' | 'done' | 'failed';
type UploadChip = 'PDF' | 'PPT' | 'Audio' | 'Video' | 'YouTube' | 'Paste' | 'Anki';
type FileSource = 'pdf' | 'ppt' | 'audio' | 'video';

interface StudySetUploadProps {
  studySetId: string;
  courseId?: string;
  onImport: (source?: FileSource) => void;
  onYoutube: (url: string) => Promise<void>;
  onPaste: (title: string, body: string) => Promise<void>;
  onAnki: (text: string) => Promise<void>;
  onRecord: () => void;
}

export const StudySetUpload: React.FC<StudySetUploadProps> = ({
  onImport,
  onYoutube,
  onPaste,
  onAnki,
  onRecord,
}) => {
  const jobs = useAiJobStore((s) => s.jobs);
  const showToast = useToastStore((s) => s.showToast);
  const [filter, setFilter] = useState<JobFilter>('all');
  const [panel, setPanel] = useState<'youtube' | 'paste' | 'anki' | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteBody, setPasteBody] = useState('');
  const [ankiText, setAnkiText] = useState('');
  const [busy, setBusy] = useState(false);
  const recent = useMemo(() => {
    const rows = jobs.filter((job) => {
      if (filter === 'processing') return job.status === 'running';
      if (filter === 'done') return job.status === 'succeeded';
      if (filter === 'failed') return job.status === 'failed' || job.status === 'orphaned';
      return true;
    });
    return rows.slice(0, 8);
  }, [filter, jobs]);

  const openChip = (chip: UploadChip) => {
    if (chip === 'PDF') onImport('pdf');
    else if (chip === 'PPT') onImport('ppt');
    else if (chip === 'Audio') onImport('audio');
    else if (chip === 'Video' || chip === 'YouTube') setPanel('youtube');
    else if (chip === 'Paste') setPanel('paste');
    else setPanel('anki');
  };

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await work();
      showToast(success, 'success');
      setPanel(null);
      setYoutubeUrl('');
      setPasteTitle('');
      setPasteBody('');
      setAnkiText('');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not add that material.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">
      <div>
        <h2 className="text-heading text-lantern-text">Add materials</h2>
        <p className="text-body text-lantern-text-secondary mt-1">
          Drop a PDF, slides, or audio into this set. Quizzes and cards stay here.
        </p>
      </div>
      <button
        type="button"
        onClick={() => onImport()}
        className="w-full min-h-[12rem] rounded-2xl border border-dashed border-lantern-border px-6 py-10 text-center hover:bg-lantern-background-secondary"
      >
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-lantern-background-secondary mb-3">
          <AppIcon name="cloud-upload" size={24} />
        </span>
        <span className="block text-heading">Drop files or browse</span>
        <span className="block text-caption text-lantern-text-secondary mt-1">
          PDF, PPT, audio, video, or YouTube
        </span>
      </button>
      <div className="flex flex-wrap gap-2">
        {(['PDF', 'PPT', 'Audio', 'Video', 'YouTube', 'Paste', 'Anki'] as const).map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => openChip(chip)}
            className="min-h-[44px] rounded-full border border-lantern-border px-3 text-caption"
          >
            {chip}
          </button>
        ))}
        <Button variant="secondary" onClick={onRecord}>
          Record a lecture
        </Button>
      </div>

      {panel === 'youtube' ? (
        <Card padding="md">
          <p className="text-heading">YouTube</p>
          <p className="text-caption text-lantern-text-secondary mt-1">
            Paste a video URL. We file the transcript as a note in this set.
          </p>
          <input
            type="url"
            value={youtubeUrl}
            onChange={(event) => setYoutubeUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v="
            className="mt-3 w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
          />
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" onClick={() => setPanel(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !youtubeUrl.trim()}
              onClick={() => void run(() => onYoutube(youtubeUrl.trim()), 'YouTube note filed in this set.')}
            >
              Add video
            </Button>
          </div>
        </Card>
      ) : null}

      {panel === 'paste' ? (
        <Card padding="md">
          <p className="text-heading">Paste notes</p>
          <input
            value={pasteTitle}
            onChange={(event) => setPasteTitle(event.target.value)}
            placeholder="Note title"
            className="mt-3 w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
          />
          <textarea
            value={pasteBody}
            onChange={(event) => setPasteBody(event.target.value)}
            rows={8}
            placeholder="Paste lecture notes or reading"
            className="mt-2 w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
          />
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" onClick={() => setPanel(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !pasteBody.trim()}
              onClick={() =>
                void run(
                  () => onPaste(pasteTitle.trim() || 'Pasted notes', pasteBody.trim()),
                  'Note filed in this set.'
                )
              }
            >
              Save note
            </Button>
          </div>
        </Card>
      ) : null}

      {panel === 'anki' ? (
        <Card padding="md">
          <p className="text-heading">Anki / Quizlet</p>
          <p className="text-caption text-lantern-text-secondary mt-1">
            Paste an export: one card per line, term and definition separated by a tab.
          </p>
          <textarea
            value={ankiText}
            onChange={(event) => setAnkiText(event.target.value)}
            rows={8}
            className="mt-3 w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
          />
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" onClick={() => setPanel(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !ankiText.trim()}
              onClick={() => void run(() => onAnki(ankiText), 'Cards imported into this set.')}
            >
              Import cards
            </Button>
          </div>
        </Card>
      ) : null}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-heading">Recent uploads</h3>
          <div className="flex flex-wrap gap-1">
            {(['all', 'processing', 'done', 'failed'] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`min-h-[36px] rounded-full border px-2.5 text-caption capitalize ${
                  filter === id
                    ? 'border-transparent bg-lantern-primary-fill text-white'
                    : 'border-lantern-border text-lantern-text-secondary'
                }`}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
        {recent.length === 0 ? (
          <p className="text-body text-lantern-text-secondary">Nothing processing yet.</p>
        ) : (
          <div className="space-y-2">
            {recent.map((job) => (
              <Card key={job.id} padding="md">
                <p className="text-body font-semibold truncate">{job.title}</p>
                <p className="text-caption text-lantern-text-secondary capitalize">{job.status}</p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default StudySetUpload;
