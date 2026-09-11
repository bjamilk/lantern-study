import React, { useMemo, useState } from 'react';
import { useAiJobStore } from '../../stores/aiJobStore';
import { Button, Card } from '../ui';
import { AppIcon } from '../ui/AppIcon';

type JobFilter = 'all' | 'processing' | 'done' | 'failed';

interface StudySetUploadProps {
  studySetId: string;
  courseId?: string;
  onImport: () => void;
  onRecord: () => void;
}

export const StudySetUpload: React.FC<StudySetUploadProps> = ({ onImport, onRecord }) => {
  const jobs = useAiJobStore((s) => s.jobs);
  const [filter, setFilter] = useState<JobFilter>('all');
  const recent = useMemo(() => {
    const rows = jobs.filter((job) => {
      if (filter === 'processing') return job.status === 'running';
      if (filter === 'done') return job.status === 'succeeded';
      if (filter === 'failed') return job.status === 'failed' || job.status === 'orphaned';
      return true;
    });
    return rows.slice(0, 8);
  }, [filter, jobs]);

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
        onClick={onImport}
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
        {['PDF', 'PPT', 'Audio', 'Video', 'YouTube'].map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={onImport}
            className="min-h-[44px] rounded-full border border-lantern-border px-3 text-caption"
          >
            {chip}
          </button>
        ))}
        <Button variant="secondary" onClick={onRecord}>
          Record a lecture
        </Button>
      </div>
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
