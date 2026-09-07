/**
 * `CourseChip` — the course a row belongs to, printed once, at the right edge.
 *
 * Spec v3 §5.6: a typed list row is neutral, carries its feature disc on the
 * left and its COURSE on the right. The chip is deliberately colourless: the
 * disc already spends the row's hue on what the thing IS, and a second colour
 * for what it is ABOUT is the rainbow-noise failure §5.8 names. Its job is to
 * let a student scan a mixed list for "BIO 201" without reading titles.
 *
 * Prints the course CODE, which is already normalised ("BIO 201"). A row with
 * no course draws nothing at all — a "no course" chip would be a label on an
 * absence, and every list here is mostly unfiled.
 */
import React from 'react';
import { View } from 'react-native';
import { Label } from './Text';

export function CourseChip({
  code,
  className = '',
}: {
  /** `Course.code`, already normalised. Empty or missing draws nothing. */
  code?: string | null;
  className?: string;
}) {
  const text = (code ?? '').trim();
  if (!text) return null;
  return (
    <View
      className={`shrink-0 px-2 py-0.5 rounded-md border border-lantern-border bg-lantern-background-secondary dark:bg-lantern-surface-secondary ${className}`}
    >
      <Label
        tone="secondary"
        numberOfLines={1}
        // Spoken in full: "BIO 201" alone would be read as a stray token in
        // the middle of a row that is otherwise a sentence.
        accessibilityLabel={`Course ${text}`}
      >
        {text}
      </Label>
    </View>
  );
}

export default CourseChip;
