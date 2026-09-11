import React, { useEffect, useMemo, useState } from 'react';
import {
  pickRecommendedTopic,
  STUDY_SET_MODES,
  studySetPlanProgress,
  topicIndexLabel,
  topicsFromReadingNotes,
  type StudySetMode,
  type StudySetTopic,
  type StudySetUnit,
} from '@lantern/shared';
import type { StudyNote } from '../../types';
import { Button, Card } from '../ui';
import { fetchStudySetPlan, replaceStudySetPlan, updateStudySetTopicStatus } from '../../services/academic';
import { useToastStore } from '../../stores/toastStore';

interface StudySetPlanPanelProps {
  studySetId: string;
  notes: StudyNote[];
  mode: StudySetMode;
  onModeChange: (mode: StudySetMode) => void;
  onStart: (kind: 'read' | 'quiz' | 'cards' | 'lesson', noteId?: string) => void;
}

export const StudySetPlanPanel: React.FC<StudySetPlanPanelProps> = ({
  studySetId,
  notes,
  mode,
  onModeChange,
  onStart,
}) => {
  const showToast = useToastStore((s) => s.showToast);
  const fallback = useMemo(() => topicsFromReadingNotes(studySetId, notes), [notes, studySetId]);
  const [units, setUnits] = useState<StudySetUnit[]>([fallback.unit]);
  const [topics, setTopics] = useState<StudySetTopic[]>(fallback.topics);
  const [generating, setGenerating] = useState(false);
  const [diagnosticIndex, setDiagnosticIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchStudySetPlan(studySetId)
      .then((data) => {
        if (cancelled) return;
        const nextUnits = Array.isArray((data as { units?: StudySetUnit[] })?.units)
          ? (data as { units: StudySetUnit[] }).units
          : [];
        const nextTopics = Array.isArray((data as { topics?: StudySetTopic[] })?.topics)
          ? (data as { topics: StudySetTopic[] }).topics
          : [];
        if (nextTopics.length > 0) {
          setUnits(nextUnits);
          setTopics(nextTopics);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [studySetId]);

  const progress = studySetPlanProgress(topics);
  const recommended = pickRecommendedTopic(topics, mode);

  const generateFromNotes = async () => {
    setGenerating(true);
    try {
      const built = topicsFromReadingNotes(studySetId, notes);
      const saved = await replaceStudySetPlan(studySetId, {
        units: [{ title: built.unit.title, position: built.unit.position }],
        topics: built.topics.map((topic) => ({
          unitIndex: 0,
          title: topic.title,
          position: topic.position,
          status: topic.status,
          sourceNoteIds: topic.sourceNoteIds,
        })),
      });
      setUnits((saved as { units: StudySetUnit[] }).units || [built.unit]);
      setTopics((saved as { topics: StudySetTopic[] }).topics || built.topics);
      showToast('Study plan built from your materials.', 'success');
    } catch {
      setUnits([fallback.unit]);
      setTopics(fallback.topics);
      showToast('Using a local plan from your notes until the server catches up.', 'info');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">
      <div>
        <h2 className="text-heading">Study plan</h2>
        <p className="text-caption text-lantern-text-secondary mt-1">
          {progress.topics} topics · {progress.covered} covered · {progress.mastered} mastered
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {STUDY_SET_MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onModeChange(item.id)}
            className={`min-h-[44px] rounded-full border px-3 text-caption ${
              mode === item.id
                ? 'border-transparent bg-lantern-primary-fill text-white'
                : 'border-lantern-border text-lantern-text-secondary'
            }`}
            title={item.promise}
          >
            {item.label}
          </button>
        ))}
      </div>
      {recommended ? (
        <Card padding="md">
          <p className="text-label uppercase text-lantern-text-secondary">Recommended from your study plan</p>
          <p className="text-caption text-lantern-text-secondary mt-1">
            {topicIndexLabel(topics, recommended)}
          </p>
          <h3 className="text-heading mt-1">{recommended.title}</h3>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button size="sm" onClick={() => onStart('lesson', recommended.sourceNoteIds[0])}>
              Tutor
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onStart('read', recommended.sourceNoteIds[0])}>
              Read
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onStart('quiz', recommended.sourceNoteIds[0])}>
              Quiz
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onStart('cards', recommended.sourceNoteIds[0])}>
              Cards
            </Button>
          </div>
        </Card>
      ) : (
        <Card padding="md">
          <p className="text-body text-lantern-text-secondary">
            Add materials, then generate topics. A diagnostic can mark what you already know.
          </p>
          <Button className="mt-3" onClick={() => void generateFromNotes()} disabled={generating || notes.length === 0}>
            {generating ? 'Building…' : 'Generate topics from materials'}
          </Button>
        </Card>
      )}
      {topics.length > 0 && diagnosticIndex === null ? (
        <Button
          variant="secondary"
          onClick={() => setDiagnosticIndex(0)}
        >
          See what you already know · 3 minutes
        </Button>
      ) : null}
      {diagnosticIndex !== null && topics[diagnosticIndex] ? (
        <Card padding="md">
          <p className="text-label uppercase text-lantern-text-secondary">Diagnostic</p>
          <p className="text-caption text-lantern-text-secondary mt-1">
            Topic {diagnosticIndex + 1} of {topics.length}
          </p>
          <h3 className="text-heading mt-1">{topics[diagnosticIndex].title}</h3>
          <p className="text-body text-lantern-text-secondary mt-2">
            Do you already know this well enough to skip it?
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button
              size="sm"
              onClick={() => {
                const topic = topics[diagnosticIndex];
                const next = 'covered' as const;
                setTopics((rows) =>
                  rows.map((row) => (row.id === topic.id ? { ...row, status: next } : row))
                );
                void updateStudySetTopicStatus(studySetId, topic.id, next).catch(() => undefined);
                setDiagnosticIndex(diagnosticIndex + 1 >= topics.length ? null : diagnosticIndex + 1);
              }}
            >
              I know this
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setDiagnosticIndex(diagnosticIndex + 1 >= topics.length ? null : diagnosticIndex + 1);
              }}
            >
              Not yet
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDiagnosticIndex(null)}>
              Skip diagnostic
            </Button>
          </div>
        </Card>
      ) : null}
      <div className="space-y-4">
        {units.map((unit) => (
          <section key={unit.id}>
            <h3 className="text-heading mb-2">{unit.title}</h3>
            <div className="space-y-2">
              {topics
                .filter((topic) => topic.unitId === unit.id)
                .map((topic) => (
                  <label
                    key={topic.id}
                    className="flex items-center gap-3 rounded-xl border border-lantern-border p-3"
                  >
                    <input
                      type="checkbox"
                      checked={topic.status !== 'unseen'}
                      onChange={() => {
                        const next = topic.status === 'unseen' ? 'covered' : topic.status === 'covered' ? 'mastered' : 'unseen';
                        setTopics((rows) =>
                          rows.map((row) => (row.id === topic.id ? { ...row, status: next } : row))
                        );
                        void updateStudySetTopicStatus(studySetId, topic.id, next).catch(() => undefined);
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-semibold truncate">{topic.title}</span>
                      <span className="block text-caption text-lantern-text-secondary capitalize">
                        {topic.status}
                      </span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => onStart('read', topic.sourceNoteIds[0])}>
                      Open
                    </Button>
                  </label>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default StudySetPlanPanel;
