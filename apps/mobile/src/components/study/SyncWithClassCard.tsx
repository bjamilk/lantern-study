/**
 * "Sync with your class" on the phone — the first landing in an empty set.
 *
 * The web card's twin (components/study/SyncWithClassCard.tsx), and
 * deliberately the same copy, the same two doors and the same price on the
 * button. Where they differ is only where the platform differs: the file
 * picker is `expo-document-picker` rather than an `<input type=file>`, and the
 * exam date is the native `DateTimePicker` rather than `<input type=date>`.
 *
 * WHAT THIS REPLACES. The set room's empty state already drew two cards headed
 * "Add your syllabus" and "Exam dates", and both were soft dead doors: the
 * first navigated to the generic import sheet (nothing in the app knew what a
 * syllabus was) and the second opened the calendar screen, where the date
 * field only ever wrote a COURSE enrolment — so a course-less set, which is
 * most of them, could not keep a date at all.
 *
 * NEVER A WALL. `Skip for now` hides it for this set, on every device: the
 * decision is written to the account (`settings.syncClassSkipped`, the key the
 * browser writes too), with `syncClassSkipStore`'s AsyncStorage copy kept as
 * the offline cache so a failed write still hides the card here.
 *
 * DEGRADATION. The parent renders this only when the server said `supported`.
 * 20260918150000 is hand-applied, so before it lands there is no card — rather
 * than an upload button that answers 503 after a student has waited for a
 * 20 MB upload.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  MAX_SYLLABUS_BYTES,
  formatCreditCost,
  toDateOnlyLocal,
  type StudySetSyllabusResponse,
  type SyllabusSummary,
} from '@lantern/shared';
import { AI_FEATURE_CREDIT_COST } from '@lantern/shared/utils/aiCredits';
import { Button, Card, T } from '../ui';
import { AppIcon } from '../ui/AppIcon';

export interface SyncWithClassCardProps {
  examDate: string | null;
  syllabus: StudySetSyllabusResponse | null;
  uploading?: boolean;
  foundLabel?: string | null;
  error?: string | null;
  /** Opens the document picker and uploads. Owned by the screen. */
  onUploadSyllabus: () => void;
  onUndoSyllabus: () => void;
  onSkipToMaterials: () => void;
  onSkipForNow: () => void;
  /** `null` clears the date. */
  onSaveExamDate: (value: string | null) => void;
  /** The server could not store the date — 20260911140000 never applied. */
  examDateUnsupported?: string | null;
}

/** The weeks list, capped in the UI as it is capped in the column. */
function SyllabusWeeks({ summary }: { summary: SyllabusSummary }) {
  const [expanded, setExpanded] = useState(false);
  // Six is what fits on a phone without turning a card meant to be skimmed
  // into a 60-row scroll inside a scroll.
  const shown = expanded ? summary.weeks : summary.weeks.slice(0, 6);
  return (
    <View className="mt-3">
      <View className="overflow-hidden rounded-xl border border-lantern-border">
        {shown.map((week, index) => (
          <View
            key={week.week}
            className={`flex-row items-center gap-2 px-3 py-2 ${
              index > 0 ? 'border-t border-lantern-border' : ''
            }`}
          >
            <T.Caption tone="secondary" className="w-12">
              Wk {week.week}
            </T.Caption>
            <T.Body className="flex-1" numberOfLines={1}>
              {week.title}
            </T.Body>
            {week.examLabel ? <T.Caption>{week.examLabel}</T.Caption> : null}
            {week.date ? (
              <T.Caption tone="secondary">{week.date}</T.Caption>
            ) : null}
          </View>
        ))}
      </View>
      {summary.weeks.length > 6 ? (
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          onPress={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : `Show all ${summary.weeks.length} weeks`}
        </Button>
      ) : null}
    </View>
  );
}

export function SyncWithClassCard({
  examDate,
  syllabus,
  uploading,
  foundLabel,
  error,
  onUploadSyllabus,
  onUndoSyllabus,
  onSkipToMaterials,
  onSkipForNow,
  onSaveExamDate,
  examDateUnsupported,
}: SyncWithClassCardProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const summary = syllabus?.summary ?? null;
  const hasSyllabus = Boolean(syllabus?.noteId);

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    setPickerOpen(false);
    if (event.type === 'dismissed' || !selected) return;
    // `toDateOnlyLocal`, never `toISOString().slice(0,10)`: the picker hands
    // back local midnight, and west of Greenwich the UTC slice is the day
    // before — which is how an exam date silently lands one day early.
    onSaveExamDate(toDateOnlyLocal(selected));
  };

  return (
    <Card>
      {/* `Card` takes no testID, so the handle for a test sits on the first
          child View rather than being smuggled through as an unknown prop. */}
      <View testID="sync-with-class" className="flex-row items-start justify-between gap-2">
        <T.Title className="flex-1">Sync with your class</T.Title>
        <Pressable
          onPress={onSkipForNow}
          accessibilityRole="button"
          accessibilityLabel="Skip syncing with your class for this set"
          // 44px target around a caption-sized label.
          hitSlop={12}
        >
          <T.Caption tone="secondary">Skip for now</T.Caption>
        </Pressable>
      </View>
      <T.Caption tone="secondary" className="mt-1">
        Upload your syllabus and Lantern will work out which topics belong to which exam, or add
        your exam dates by hand.
      </T.Caption>

      <Button className="mt-4" onPress={onUploadSyllabus} disabled={uploading}>
        {uploading ? 'Reading your syllabus…' : `Upload syllabus · ${formatCreditCost(AI_FEATURE_CREDIT_COST)}`}
      </Button>
      <Button variant="secondary" className="mt-2" onPress={onSkipToMaterials}>
        Skip and upload materials
      </Button>

      {uploading ? (
        <View className="mt-2 flex-row items-center gap-2">
          <ActivityIndicator size="small" />
          <T.Caption tone="secondary">This takes a few seconds.</T.Caption>
        </View>
      ) : null}

      {error ? (
        // `T` has no error tone (text | secondary | tertiary), so the colour
        // comes from the class and the tone stays honest.
        <T.Caption
          className="mt-2 text-lantern-error"
          accessibilityLiveRegion="polite"
        >
          {error}
        </T.Caption>
      ) : null}

      {/* The result inline, with its Undo — not a toast that is gone before
          the number has been read. */}
      {foundLabel ? (
        <View
          testID="sync-with-class-result"
          className="mt-3 flex-row items-center justify-between gap-2 rounded-xl bg-lantern-background-secondary px-3 py-2"
        >
          <T.Body className="flex-1">{foundLabel}</T.Body>
          <Pressable onPress={onUndoSyllabus} accessibilityRole="button" hitSlop={12}>
            <T.Caption>Undo</T.Caption>
          </Pressable>
        </View>
      ) : null}

      {summary ? <SyllabusWeeks summary={summary} /> : null}

      <View className="mt-4 gap-3">
        <View className="rounded-xl border border-lantern-border p-3">
          <View className="flex-row items-center gap-1.5">
            <T.Body>Add your syllabus</T.Body>
            <AppIcon
              name="information-circle"
              size={14}
              accessibilityLabel="Lantern reads the week-by-week schedule and any exam dates out of the document. The file is filed in this set as a note you can open."
            />
          </View>
          <T.Caption tone="secondary" className="mt-1">
            Tailor your study plan to your class schedule and priorities.
          </T.Caption>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onPress={onUploadSyllabus}
            disabled={uploading}
          >
            {hasSyllabus ? 'Replace syllabus' : 'Add syllabus'}
          </Button>
        </View>

        <View className="rounded-xl border border-lantern-border p-3">
          <T.Body>Exam dates</T.Body>
          <T.Caption tone="secondary" className="mt-1">
            Make sure you are studying what you need to before your exams.
          </T.Caption>
          {examDate ? (
            <View className="mt-3 flex-row flex-wrap items-center gap-2">
              <T.Body>{examDate}</T.Body>
              <Button size="sm" variant="secondary" onPress={() => setPickerOpen(true)}>
                Change
              </Button>
              <Button size="sm" variant="secondary" onPress={() => onSaveExamDate(null)}>
                Remove
              </Button>
            </View>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onPress={() => setPickerOpen(true)}
            >
              Add exam
            </Button>
          )}
          {/* The honesty line: the server can answer a set PATCH without
              storing the date when 20260918150000 is unapplied, and a green
              toast over a row that never changed is the failure this whole
              lane exists to end. */}
          {examDateUnsupported ? (
            <T.Caption tone="secondary" className="mt-2">
              {examDateUnsupported}
            </T.Caption>
          ) : null}
          {pickerOpen ? (
            <DateTimePicker
              value={examDate ? new Date(`${examDate}T00:00:00`) : new Date()}
              mode="date"
              onChange={onPickerChange}
            />
          ) : null}
        </View>
      </View>
    </Card>
  );
}

export default SyncWithClassCard;
