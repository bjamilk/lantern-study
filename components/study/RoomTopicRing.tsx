import React from 'react';
import type { StudySetTopicStatus } from '@lantern/shared';

/**
 * How far into a topic a status actually is.
 *
 * Three states, so three stops. `covered` is drawn as half rather than as
 * "done": a topic you have read once and a topic you have proved you know are
 * not the same thing, and the ring is the only place on this screen that says
 * so. Exported so the number is testable and so nothing else invents a fourth.
 */
export function topicRingPercent(status: StudySetTopicStatus): number {
  if (status === 'mastered') return 100;
  if (status === 'covered') return 50;
  return 0;
}

interface RoomTopicRingProps {
  status: StudySetTopicStatus;
  size?: number;
}

/**
 * The progress ring beside the plan band's current topic.
 *
 * Painted in the AI feature's violet over its lilac tint — the tint token IS
 * the reference's #f5d5ff — and NOT in the app's ink. A deliberate exception to
 * this palette's one-ink rule, and it matches the reference: progress is the one
 * thing on a study screen that earns colour, and a black arc on a grey donut
 * reads as a disabled control rather than as "you are half way".
 *
 * The status is already stated in words beside it, so the ring is decorative to
 * a screen reader and stays out of the a11y tree.
 */
export const RoomTopicRing: React.FC<RoomTopicRingProps> = ({ status, size = 44 }) => {
  const percent = topicRingPercent(status);
  const stroke = Math.max(3, Math.round(size * 0.1));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        // Literal class strings: Tailwind's scanner cannot see a computed one,
        // and there is no FEATURE_*_STROKE map to reach for (the tint/ink maps
        // are backgrounds and text). One hue, named twice, in one file.
        className="stroke-lantern-feature-ai-tint"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(circumference * percent) / 100} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="stroke-lantern-feature-ai-ink"
      />
    </svg>
  );
};

export default RoomTopicRing;
