import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  lectureAudioAttachment,
  lectureNoteParts,
  lectureTabs,
  lectureTranscriptLines,
  preferLectureTranscript,
  resolveLectureTab,
  type LectureTabId,
  type LectureTabSource,
} from '@lantern/shared';
import { T } from '../ui';
import { NoteBody } from '../NoteBody';
import { LectureAudioPlayer } from './LectureAudioPlayer';
import { isLectureTabLocked } from './lectureTabLock';

/**
 * The lecture surface — My Notes / Enhanced Notes / Transcript / Audio.
 *
 * This used to live inside `screens/study/LectureStudioScreen.tsx`, which is
 * only reachable from a set or course room. Every lecture opened from the
 * Library went to `NoteEditorScreen` instead, where the stored body renders as
 * one scroll: the transcript dumped under the typed notes, the enhanced notes
 * after that, and the recording nowhere at all (build 192's device pass —
 * the one real recorded lecture had no tabs and no player).
 *
 * So the surface is a component, not a screen. Both doors mount the same tab
 * row over the same shared planner (`lectureTabs` in
 * `packages/shared/src/learning/lectureStudio.ts`), which is what stops either
 * client from inventing an empty tab or quietly dropping a real one.
 *
 * My Notes is a render prop rather than a body of its own: the studio's
 * version is a live editor that stamps timestamps while class is running, the
 * library's is a reading view that hands off to the raw editor. The other
 * three tabs are identical either way, so they live here.
 */
export interface LectureTabsProps {
  /** Needed only to play — and re-sign — the audio attachment. */
  noteId?: string | null;
  source: LectureTabSource;
  /** A take is running: the tab row locks onto My Notes. */
  recording?: boolean;
  /** The My Notes pane. `typed` is the body with transcript and Smart Notes removed. */
  renderNotes: (parts: { typed: string }) => React.ReactNode;
  /** Controlled selection. Omit to let this component keep its own. */
  tab?: LectureTabId | null;
  onTabChange?: (tab: LectureTabId) => void;
}

export function LectureTabs({
  noteId,
  source,
  recording = false,
  renderNotes,
  tab: controlledTab,
  onTabChange,
}: LectureTabsProps) {
  /** null = follow the default rule; a value = the student picked that tab. */
  const [ownTab, setOwnTab] = useState<LectureTabId | null>(null);
  const requested = controlledTab === undefined ? ownTab : controlledTab;

  const tabs = lectureTabs(source);
  const active = resolveLectureTab(source, requested, { recording });
  const parts = lectureNoteParts(source);
  const transcriptLines = lectureTranscriptLines(
    preferLectureTranscript(parts.transcript, (source.liveTranscript ?? '').trim())
  );
  const audioRow = lectureAudioAttachment(source);

  const pick = (next: LectureTabId) => {
    if (controlledTab === undefined) setOwnTab(next);
    onTabChange?.(next);
  };

  return (
    <View className="gap-4">
      {/* The same four surfaces as the web studio, in the same order. */}
      <View accessibilityRole="tablist" className="flex-row flex-wrap gap-2">
        {tabs.map((row) => {
          const selected = active === row.id;
          const locked = isLectureTabLocked(row.id, recording);
          return (
            <Pressable
              key={row.id}
              onPress={() => pick(row.id)}
              disabled={locked}
              accessibilityRole="tab"
              accessibilityState={{ selected, disabled: locked }}
              accessibilityLabel={row.label}
              className={`min-h-[44px] justify-center rounded-full border px-3 ${
                selected
                  ? 'border-lantern-primary bg-lantern-primary'
                  : 'border-lantern-border bg-lantern-surface'
              }`}
              style={locked ? { opacity: 0.5 } : undefined}
            >
              <T.Body style={selected ? { color: '#ffffff' } : undefined}>{row.label}</T.Body>
            </Pressable>
          );
        })}
      </View>

      {active === 'notes' ? renderNotes({ typed: parts.typed }) : null}

      {active === 'enhanced' ? (
        <View>
          <T.Label>Enhanced notes</T.Label>
          <View className="mt-2 min-h-[140px] rounded-xl border border-lantern-border bg-lantern-surface p-3">
            <NoteBody body={parts.enhanced} emptyLine="No enhanced notes yet." />
          </View>
        </View>
      ) : null}

      {active === 'transcript' ? (
        <View>
          <T.Label>Transcript</T.Label>
          <View className="mt-2 min-h-[140px] rounded-xl border border-lantern-border bg-lantern-surface p-3">
            {transcriptLines.length ? (
              <View style={{ gap: 8 }}>
                {transcriptLines.map((line, index) => (
                  <View key={`${line.time ?? ''}-${index}`} className="flex-row" style={{ gap: 12 }}>
                    {/* The gutter time reads as a caption; the sentence stays body prose. */}
                    <T.Caption tone="secondary" tabular style={{ width: 48 }}>
                      {line.time ?? ''}
                    </T.Caption>
                    <T.Body style={{ flexShrink: 1, flexGrow: 0, flexBasis: 'auto' }}>
                      {line.text}
                    </T.Body>
                  </View>
                ))}
              </View>
            ) : (
              <T.Body tone="tertiary">
                Captions save into this note as you go. The full transcript lands after you stop.
              </T.Body>
            )}
          </View>
        </View>
      ) : null}

      {active === 'audio' ? (
        <View>
          <T.Label>Audio</T.Label>
          <View className="mt-2">
            {noteId && audioRow ? (
              <LectureAudioPlayer noteId={noteId} attachment={audioRow} />
            ) : (
              <T.Body tone="tertiary">No recording is saved on this lecture yet.</T.Body>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default LectureTabs;
