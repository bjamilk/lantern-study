import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  JOB_APPLICATION_NOTE_MAX_LENGTH,
  type JobApplicationNote,
} from "@lantern/shared";
import {
  createJobApplicationNote,
  deleteJobApplicationNote,
  fetchJobApplicationNotes,
} from "../../services/jobsBoard";

interface Props {
  applicationId: string;
  currentUserId?: string | null;
  onCountChange?: (applicationId: string, count: number) => void;
}

function formatNoteDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function JobApplicantNotes({
  applicationId,
  currentUserId,
  onCountChange,
}: Props) {
  const [notes, setNotes] = useState<JobApplicationNote[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchJobApplicationNotes(applicationId)
      .then((res) => {
        if (!active) return;
        const loaded = res.data || [];
        setNotes(loaded);
        onCountChange?.(applicationId, loaded.length);
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : "Could not load notes");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applicationId]);

  const addNote = async () => {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await createJobApplicationNote(applicationId, body);
      setNotes((prev) => {
        const next = [res.data, ...prev];
        onCountChange?.(applicationId, next.length);
        return next;
      });
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the note");
    } finally {
      setSaving(false);
    }
  };

  const removeNote = async (noteId: string) => {
    const previous = notes;
    const next = notes.filter((note) => note.id !== noteId);
    setNotes(next);
    onCountChange?.(applicationId, next.length);
    try {
      await deleteJobApplicationNote(noteId);
    } catch (e) {
      setNotes(previous);
      onCountChange?.(applicationId, previous.length);
      setError(e instanceof Error ? e.message : "Could not delete the note");
    }
  };

  return (
    <View className="mt-4 border-t border-lantern-border pt-3">
      <Text className="text-sm font-semibold text-lantern-text">
        Private notes
      </Text>
      <Text className="mt-0.5 text-xs text-lantern-text-tertiary">
        Only your hiring team can see these
      </Text>

      <TextInput
        value={draft}
        onChangeText={setDraft}
        multiline
        maxLength={JOB_APPLICATION_NOTE_MAX_LENGTH}
        placeholder="Strong portfolio, available from September…"
        placeholderTextColor="#94a3b8"
        accessibilityLabel="Add a note about this candidate"
        className="mt-2 min-h-[64px] rounded-xl border border-lantern-border bg-lantern-background px-3 py-2 text-sm text-lantern-text"
        textAlignVertical="top"
      />
      <Pressable
        onPress={() => void addNote()}
        disabled={!draft.trim() || saving}
        accessibilityRole="button"
        className={`mt-2 self-start rounded-lg px-3 py-2 ${
          !draft.trim() || saving
            ? "bg-lantern-primary/50"
            : "bg-lantern-primary"
        }`}
      >
        <Text className="text-sm font-semibold text-white">
          {saving ? "Saving…" : "Add note"}
        </Text>
      </Pressable>

      {error ? (
        <Text className="mt-2 text-xs font-medium text-red-600">{error}</Text>
      ) : null}

      {loading ? (
        <ActivityIndicator className="mt-3" color="#0f766e" size="small" />
      ) : notes.length === 0 ? (
        <Text className="mt-3 text-xs text-lantern-text-tertiary">
          No notes yet. Record why you advanced or passed on this candidate.
        </Text>
      ) : (
        notes.map((note) => (
          <View
            key={note.id}
            className="mt-2 rounded-xl border border-lantern-border bg-lantern-background p-3"
          >
            <View className="flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-xs font-medium text-lantern-text-secondary">
                {note.author?.name || note.author?.username || "Teammate"}
                {"  "}
                <Text className="font-normal text-lantern-text-tertiary">
                  {formatNoteDate(note.createdAt)}
                </Text>
              </Text>
              {note.authorId === currentUserId ? (
                <Pressable
                  onPress={() => void removeNote(note.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Delete note"
                  hitSlop={8}
                >
                  <Text className="text-xs font-medium text-lantern-text-tertiary">
                    Delete
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Text className="mt-1 text-sm text-lantern-text">{note.body}</Text>
          </View>
        ))
      )}
    </View>
  );
}

export default JobApplicantNotes;
