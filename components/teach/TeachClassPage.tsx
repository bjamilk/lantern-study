import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  ClassAnalytics,
  ClassAssignment,
  ClassGenerateResult,
  ClassMaterial,
  ClassMember,
  ClassSection,
  StudyNote,
} from '@lantern/shared';
import { classJoinPath, teachClassPath, teachHomePath } from '@lantern/shared/academic';
import { Button, Card, Input, Tabs, TabList, Tab, TabPanel } from '../ui';
import { useNotesStore } from '../../stores/notesStore';
import {
  addClassMaterial,
  addClassMember,
  createClassAssignment,
  deleteClassMaterial,
  fetchClass,
  fetchClassAnalytics,
  fetchClassAssignments,
  fetchClassMaterials,
  fetchClassRoster,
  generateClassContent,
  patchClassMember,
  publishClassMaterial,
  rotateClassJoinCode,
  unpublishClassMaterial,
} from '../../services/classes';
import { TeachJoinQr } from './TeachJoinQr';

type ClassTab = 'roster' | 'materials' | 'assign' | 'analytics';

interface TeachClassPageProps {
  classId: string;
  tab: ClassTab;
}

export const TeachClassPage: React.FC<TeachClassPageProps> = ({ classId, tab }) => {
  const navigate = useNavigate();
  const [cls, setCls] = useState<ClassSection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const row = await fetchClass(classId);
    setCls(row);
  }, [classId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'Could not load class');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (loading) {
    return <p className="p-8 text-body text-lantern-text-secondary">Loading class…</p>;
  }
  if (error || !cls) {
    return (
      <div className="p-8">
        <p className="text-body text-lantern-error">{error || 'Class not found'}</p>
        <Button className="mt-4" variant="secondary" onClick={() => navigate(teachHomePath())}>
          Back to classes
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-8">
      <div>
        <p className="text-caption text-lantern-text-secondary">
          {cls.course.code} · {cls.academicYear}
        </p>
        <h1 className="text-title font-semibold text-lantern-text">{cls.title}</h1>
      </div>
      <Tabs
        value={tab}
        onValueChange={(next) => navigate(teachClassPath(classId, next as ClassTab))}
      >
        <TabList>
          <Tab value="roster">Roster</Tab>
          <Tab value="materials">Materials</Tab>
          <Tab value="assign">Assign</Tab>
          <Tab value="analytics">Analytics</Tab>
        </TabList>
        <TabPanel value="roster">
          <RosterTab cls={cls} onRefresh={load} />
        </TabPanel>
        <TabPanel value="materials">
          <MaterialsTab classId={classId} />
        </TabPanel>
        <TabPanel value="assign">
          <AssignTab classId={classId} />
        </TabPanel>
        <TabPanel value="analytics">
          <AnalyticsTab classId={classId} />
        </TabPanel>
      </Tabs>
    </div>
  );
};

const RosterTab: React.FC<{ cls: ClassSection; onRefresh: () => Promise<void> }> = ({ cls, onRefresh }) => {
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRoster = useCallback(async () => {
    setMembers(await fetchClassRoster(cls.id));
  }, [cls.id]);

  useEffect(() => {
    void loadRoster().catch((err: Error) => setError(err.message));
  }, [loadRoster]);

  const copyCode = async () => {
    if (!cls.joinCode) return;
    const url = `${window.location.origin}${classJoinPath(cls.joinCode)}`;
    await navigator.clipboard.writeText(`${cls.joinCode} — ${url}`);
  };

  return (
    <div className="flex flex-col gap-6 pt-4">
      {cls.joinCode ? (
        <Card padding="md" className="flex flex-col md:flex-row items-center gap-6">
          <div className="flex-1">
            <p className="text-caption text-lantern-text-secondary">Join code</p>
            <p className="font-mono text-display tracking-widest text-lantern-text">{cls.joinCode}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => void copyCode()}>
                Copy code & link
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await rotateClassJoinCode(cls.id);
                  await onRefresh();
                }}
              >
                Rotate code
              </Button>
            </div>
          </div>
          <TeachJoinQr code={cls.joinCode} />
        </Card>
      ) : null}

      <form
        className="flex flex-wrap gap-2 items-end"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await addClassMember(cls.id, { username, role: 'student' });
            setUsername('');
            await loadRoster();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not add member');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex flex-col gap-1 flex-1 min-w-[12rem]">
          <span className="text-caption text-lantern-text-secondary">Add by username</span>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ada" />
        </label>
        <Button type="submit" disabled={busy || !username.trim()}>
          Add student
        </Button>
      </form>
      {error ? <p className="text-body text-lantern-error">{error}</p> : null}

      <ul className="divide-y divide-lantern-border rounded-lantern-lg border border-lantern-border bg-lantern-surface">
        {members.map((member) => (
          <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-body font-medium text-lantern-text truncate">{member.name}</p>
              <p className="text-caption text-lantern-text-secondary">
                {member.username ? `@${member.username}` : member.role}
              </p>
            </div>
            <span className="text-caption text-lantern-text-secondary capitalize">{member.role}</span>
            {member.role !== 'instructor' ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await patchClassMember(cls.id, member.userId, { status: 'removed' });
                  await loadRoster();
                }}
              >
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
};

const MaterialsTab: React.FC<{ classId: string }> = ({ classId }) => {
  const notes = useNotesStore((s) => s.notes);
  const loadNotes = useNotesStore((s) => s.loadNotes);
  const [materials, setMaterials] = useState<ClassMaterial[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [noteId, setNoteId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setMaterials(await fetchClassMaterials(classId));
  }, [classId]);

  useEffect(() => {
    void loadNotes?.();
    void reload().catch((err: Error) => setError(err.message));
  }, [loadNotes, reload]);

  return (
    <div className="flex flex-col gap-4 pt-4">
      <p className="text-body text-lantern-text-secondary">
        Publish what you teach. Students see this in their Library as “From your lecturer”. Private student notes stay private.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          try {
            await addClassMaterial(classId, {
              title: title.trim() || undefined,
              body,
              noteId: noteId || undefined,
              kind: 'lecture',
            });
            setTitle('');
            setBody('');
            setNoteId('');
            await reload();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not add material');
          }
        }}
      >
        {notes.length > 0 ? (
          <label className="flex flex-col gap-1">
            <span className="text-caption text-lantern-text-secondary">From a note you own</span>
            <select
              className="lantern-field"
              value={noteId}
              onChange={(event) => setNoteId(event.target.value)}
            >
              <option value="">Type or paste instead</option>
              {notes.slice(0, 40).map((note: StudyNote) => (
                <option key={note.id} value={note.id}>
                  {note.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="text-caption text-lantern-text-secondary">Title</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Week 3 — Cell membranes" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-lantern-text-secondary">Lecture text</span>
          <textarea
            className="lantern-field min-h-[8rem]"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Paste the reading or lecture notes students should study from."
          />
        </label>
        <Button type="submit">Add material</Button>
      </form>
      {error ? <p className="text-body text-lantern-error">{error}</p> : null}
      <ul className="flex flex-col gap-2">
        {materials.map((material) => (
          <li key={material.id}>
            <Card padding="md" className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-body font-medium text-lantern-text truncate">{material.title}</p>
                <p className="text-caption text-lantern-text-secondary">
                  {material.publishedAt ? 'Published' : 'Draft'} · {material.kind}
                </p>
              </div>
              {material.publishedAt ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await unpublishClassMaterial(classId, material.id);
                    await reload();
                  }}
                >
                  Unpublish
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={async () => {
                    await publishClassMaterial(classId, material.id);
                    await reload();
                  }}
                >
                  Publish
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await deleteClassMaterial(classId, material.id);
                  await reload();
                }}
              >
                Delete
              </Button>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
};

const AssignTab: React.FC<{ classId: string }> = ({ classId }) => {
  const [assignments, setAssignments] = useState<ClassAssignment[]>([]);
  const [generated, setGenerated] = useState<ClassGenerateResult | null>(null);
  const [title, setTitle] = useState('Practice quiz');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setAssignments(await fetchClassAssignments(classId));
  }, [classId]);

  useEffect(() => {
    void reload().catch((err: Error) => setError(err.message));
  }, [reload]);

  return (
    <div className="flex flex-col gap-4 pt-4">
      <p className="text-body text-lantern-text-secondary">
        Generate a quiz or flashcards from published materials, then assign them to the roster.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setGenerated(await generateClassContent(classId, { kind: 'quiz', count: 10 }));
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Generation failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          Generate quiz
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setGenerated(await generateClassContent(classId, { kind: 'flashcards', count: 12 }));
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Generation failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          Generate flashcards
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setGenerated(await generateClassContent(classId, { kind: 'outline' }));
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Generation failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          Topic outline
        </Button>
      </div>
      {generated ? (
        <Card padding="md" className="flex flex-col gap-3">
          <p className="text-body text-lantern-text">
            {generated.kind === 'quiz'
              ? `${generated.questions?.length ?? 0} questions ready`
              : generated.kind === 'flashcards'
                ? `${generated.cards?.length ?? 0} cards ready`
                : `${generated.outline?.length ?? 0} outline lines`}
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-caption text-lantern-text-secondary">Assignment title</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <Button
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                await createClassAssignment(classId, {
                  title: title.trim() || 'Practice',
                  kind: generated.kind === 'flashcards' ? 'deck' : generated.kind === 'quiz' ? 'test' : 'open',
                  payload: {
                    questions: generated.questions,
                    cards: generated.cards,
                    outline: generated.outline,
                  },
                });
                setGenerated(null);
                await reload();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not assign');
              } finally {
                setBusy(false);
              }
            }}
          >
            Assign to class
          </Button>
        </Card>
      ) : null}
      {error ? <p className="text-body text-lantern-error">{error}</p> : null}
      <ul className="flex flex-col gap-2">
        {assignments.map((assignment) => (
          <li key={assignment.id}>
            <Card padding="md">
              <p className="text-body font-medium text-lantern-text">{assignment.title}</p>
              <p className="text-caption text-lantern-text-secondary">
                {assignment.kind}
                {assignment.completionCount != null ? ` · ${assignment.completionCount} completed` : ''}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
};

const AnalyticsTab: React.FC<{ classId: string }> = ({ classId }) => {
  const [data, setData] = useState<ClassAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchClassAnalytics(classId)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [classId]);

  if (error) return <p className="pt-4 text-body text-lantern-error">{error}</p>;
  if (!data) return <p className="pt-4 text-body text-lantern-text-secondary">Loading analytics…</p>;

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="grid grid-cols-3 gap-3">
        <Card padding="md">
          <p className="text-caption text-lantern-text-secondary">Members</p>
          <p className="text-title font-semibold">{data.memberCount}</p>
        </Card>
        <Card padding="md">
          <p className="text-caption text-lantern-text-secondary">Published materials</p>
          <p className="text-title font-semibold">{data.publishedMaterialCount}</p>
        </Card>
        <Card padding="md">
          <p className="text-caption text-lantern-text-secondary">Assignments</p>
          <p className="text-title font-semibold">{data.assignmentCount}</p>
        </Card>
      </div>
      <ul className="divide-y divide-lantern-border rounded-lantern-lg border border-lantern-border bg-lantern-surface">
        {data.students.map((student) => (
          <li key={student.userId} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-body font-medium text-lantern-text truncate">{student.name}</p>
              <p className="text-caption text-lantern-text-secondary">
                {student.completedAssignments} completed
                {student.lastActivityAt
                  ? ` · last active ${new Date(student.lastActivityAt).toLocaleDateString()}`
                  : ' · no activity yet'}
              </p>
            </div>
            {student.atRisk ? (
              <span className="text-caption font-medium text-lantern-error">Needs attention</span>
            ) : (
              <span className="text-caption text-lantern-text-secondary">On track</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
