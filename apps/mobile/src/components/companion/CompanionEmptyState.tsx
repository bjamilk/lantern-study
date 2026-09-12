/**
 * What the companion says before it has said anything.
 *
 * The phone used to open on one grey sentence — "Ask anything about your study
 * plan, flashcards, or tests." — above a block of pills. The web rail opens on
 * a face: the `sparkles-book` illustration in the `ai` ink, a greeting, and
 * then the pills. Same asset, same two lines, so the two surfaces are
 * recognisably the same companion.
 */
import React from 'react';
import { View } from 'react-native';
import { T } from '../ui';
import { Illustration } from '../ui/Illustration';

export function CompanionEmptyState() {
  return (
    <View className="items-center px-4" accessibilityRole="summary">
      <Illustration name="sparkles-book" feature="ai" size={96} />
      <T.Heading style={{ marginTop: 12, fontWeight: '700', textAlign: 'center' }}>
        Hi, I&apos;m Lantern!
      </T.Heading>
      <T.Body tone="secondary" style={{ marginTop: 4, textAlign: 'center' }}>
        Your personal AI study companion. Ask me anything.
      </T.Body>
    </View>
  );
}

export default CompanionEmptyState;
