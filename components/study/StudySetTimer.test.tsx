// @vitest-environment jsdom
/**
 * The header pill's first paint.
 *
 * The live defect this covers: a set room opened on `Time's up` — a nag about a
 * run that had ended while the tab was closed — and only fell back to `25m`
 * after the student clicked the pill or reloaded. The pill must be derivable
 * from state alone, so these tests never click to make the truth appear.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudySetTimer } from './StudySetTimer';
import {
  STUDY_TIMER_DEFAULT_SECONDS,
  useStudySetTimerStore,
} from '../../stores/studySetTimerStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SET_ID = 'set-pharm';

let container: HTMLDivElement;
let root: Root;

const mount = async (node: React.ReactElement) => {
  await act(async () => {
    root.render(node);
  });
};

/** What the pill itself says, ignoring the popover underneath it. */
const pillText = () => (container.querySelector('button')?.textContent || '').trim();

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useStudySetTimerStore.setState({ timers: {} });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe('StudySetTimer pill', () => {
  it('opens idle when a persisted run expired before the room was opened', async () => {
    // A 25-minute run started an hour ago: finished, and nobody saw it finish.
    useStudySetTimerStore.setState({
      timers: {
        [SET_ID]: {
          baseSeconds: STUDY_TIMER_DEFAULT_SECONDS,
          startedAtMs: Date.now() - 60 * 60_000,
        },
      },
    });

    await mount(<StudySetTimer setId={SET_ID} />);

    expect(pillText()).toBe('25m');
    expect(pillText()).not.toContain("Time's up");
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Start study timer. 25:00 left'
    );
    // And the finished run is gone, so the next page load starts clean too.
    expect(useStudySetTimerStore.getState().timers[SET_ID]).toBeUndefined();
  });

  it("says Time's up for a run that expires while the room is mounted, then idles once acknowledged", async () => {
    await mount(<StudySetTimer setId={SET_ID} />);

    // A one-minute run, started here, watched all the way down.
    await act(async () => {
      useStudySetTimerStore.getState().start(SET_ID, 60);
    });
    expect(pillText()).toBe('01:00');

    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    expect(pillText()).toBe("Time's up");

    // Acknowledging it — opening the popover — retires the run for good.
    await act(async () => {
      container
        .querySelector('button')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(pillText()).toBe('25m');
    expect(useStudySetTimerStore.getState().timers[SET_ID]).toBeUndefined();
  });
});
