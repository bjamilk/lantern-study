import React, { useState } from 'react';
import Modal from './ui/Modal';
import { CoursePicker } from './academic/CoursePicker';
import { joinOrCreateStudyRoom } from '../services/supabase';
import { COMMUNITY_COPY, type StudyRoomDetail } from '@lantern/shared/network';
import { useToastStore } from '../stores/toastStore';

export interface CreateLabModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (room: StudyRoomDetail) => void;
  /**
   * Start a room from inside a community (spec §5.8): no course picker, the
   * room carries `communityId` (+ the course for a course community), so
   * join-or-create lands everyone in that community's one open room.
   */
  community?: { id: string; name: string; courseId: string | null } | null;
}

/**
 * Start a study room for a course (Phase 4 · V). Replaces the empty stub.
 */
const CreateLabModal: React.FC<CreateLabModalProps> = ({ isOpen, onClose, onCreated, community }) => {
  const showToast = useToastStore((s) => s.showToast);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const canSubmit = community ? !busy : !!courseId && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const room = await joinOrCreateStudyRoom(
        community
          ? { communityId: community.id, courseId: community.courseId, topic: topic.trim() || null }
          : { courseId, topic: topic.trim() || null }
      );
      onCreated(room);
      setTopic('');
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not open a study room', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabelledBy="create-lab-title" maxWidthClass="max-w-md">
      <div className="p-5">
        <h2 id="create-lab-title" className="text-lg font-semibold text-lantern-text">
          Start a study room
        </h2>
        <p className="mt-1 text-sm text-lantern-text-secondary">
          {community
            ? 'Members of this community can join — if a room is already open here, you land there. Rooms are temporary and close on their own.'
            : 'People studying the same course can join — if a room is already open for it, you land there. Rooms are temporary and close on their own.'}
        </p>
        {community ? (
          <p className="mt-4 text-sm font-medium text-lantern-text">{COMMUNITY_COPY.startRoomIn(community.name)}</p>
        ) : (
          <div className="mt-4">
            <CoursePicker
              value={courseId}
              onChange={(course) => setCourseId(course?.id ?? null)}
              label="Course"
            />
          </div>
        )}
        <label className="mt-3 block text-sm font-medium text-lantern-text">
          Topic <span className="font-normal text-lantern-text-tertiary">(optional)</span>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={80}
            placeholder="e.g. cardiology"
            className="mt-1 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 py-2 text-sm"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-lantern-text-secondary hover:bg-lantern-background-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="rounded-lg bg-lantern-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Opening…' : 'Join or create'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default CreateLabModal;
