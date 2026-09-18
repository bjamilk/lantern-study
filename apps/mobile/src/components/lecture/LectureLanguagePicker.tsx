/**
 * The recorder's two language choices, on the phone.
 *
 * Same account setting as the browser's ⚙ popover (`UserSettings.lecture`),
 * so a student who picks Yoruba on the laptop finds Yoruba here. Written
 * through `useSettingsStore.updateSettings('lecture', …)`, which merges the
 * category and syncs — the same path the notification toggles use.
 *
 * What the phone deliberately does NOT have is the browser's microphone
 * picker. `expo-av`'s recorder exposes no way to choose an input on Android,
 * and a control that cannot change anything is worse than no control. The
 * pre-flight card's Level row is what tells a student whether the microphone
 * they have is working.
 *
 * "Transcribe to" has two entries, because Whisper's translate task produces
 * English and nothing else. The list comes from the shared registry rather
 * than a local array so a third option cannot be added here without adding it
 * to the thing that decides.
 */
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import {
  LECTURE_SPOKEN_LANGUAGES,
  LECTURE_TRANSCRIBE_TARGETS,
  normalizeLectureSpokenLanguage,
  normalizeLectureTranscribeTarget,
} from '@lantern/shared/utils/lectureAudio';
import { Card } from '../ui';
import { Caption, Label } from '../ui/Text';
import { Body } from '../ui/Text';
import { useSettingsStore } from '../../stores/settingsStore';

interface ChipRowProps {
  label: string;
  options: readonly { id: string; label: string }[];
  selected: string;
  onSelect: (id: string) => void;
}

const ChipRow: React.FC<ChipRowProps> = ({ label, options, selected, onSelect }) => (
  <View>
    <Label>{label}</Label>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2">
      <View className="flex-row gap-2">
        {options.map((option) => (
          <Pressable
            key={option.id}
            onPress={() => onSelect(option.id)}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${option.label}`}
            accessibilityState={{ selected: selected === option.id }}
            className={`min-h-[44px] justify-center rounded-full border px-3 ${
              selected === option.id
                ? 'border-lantern-primary bg-lantern-primary'
                : 'border-lantern-border bg-lantern-surface'
            }`}
          >
            <Body style={selected === option.id ? { color: '#ffffff' } : undefined}>
              {option.label}
            </Body>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  </View>
);

export function LectureLanguagePicker() {
  const lecture = useSettingsStore((s) => s.settings?.lecture);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const spokenLanguage = normalizeLectureSpokenLanguage(lecture?.spokenLanguage);
  const transcribeTo = normalizeLectureTranscribeTarget(lecture?.transcribeTo);

  return (
    <Card className="gap-3">
      <ChipRow
        label="Speaking language"
        options={LECTURE_SPOKEN_LANGUAGES}
        selected={spokenLanguage}
        onSelect={(id) => {
          void updateSettings('lecture', { spokenLanguage: normalizeLectureSpokenLanguage(id) });
        }}
      />
      <Caption tone="secondary">
        Auto-detect lets the model work it out, which is usually right. Picking the language helps
        when a lecture switches between two.
      </Caption>

      <ChipRow
        label="Transcribe to"
        options={LECTURE_TRANSCRIBE_TARGETS}
        selected={transcribeTo}
        onSelect={(id) => {
          void updateSettings('lecture', { transcribeTo: normalizeLectureTranscribeTarget(id) });
        }}
      />
      <Caption tone="secondary">
        English is the only language we can translate a lecture INTO, so it is the only target
        offered.
      </Caption>
      <Caption tone="secondary">
        This phone records on whichever microphone Android gives us — there is no input to choose.
        The Level row above is how you check it is hearing the room.
      </Caption>
    </Card>
  );
}

export default LectureLanguagePicker;
