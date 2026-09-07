import { parseDeepLink } from '@lantern/shared/linking';
import { JOB_TIME_BUDGET_MS, createJob, type TrackedJob } from '../../stores/jobsCore';
import {
  JOB_STAGE_BANDS,
  KEEP_WORKING_COPY,
  OVER_BUDGET_COPY,
  formatElapsed,
  jobActionLabel,
  jobArtefactLabel,
  jobArtifactLink,
  jobNotification,
  jobProgressView,
  jobResultLink,
  jobSheetState,
  jobStages,
  percentFor,
  stageIndexFor,
} from './jobSheetModel';

const NOW = 1_700_000_000_000;

const job = (overrides: Partial<TrackedJob> = {}): TrackedJob => ({
  ...createJob({
    id: 'j1',
    userId: 'u1',
    kind: 'flashcards',
    sourceTitle: 'Foundations of AI',
    requestedCount: 20,
    now: NOW,
  }),
  ...overrides,
});

describe('jobStages', () => {
  it('names the count when one was chosen', () => {
    expect(jobStages('flashcards', 20)).toEqual([
      'Reading your notes',
      'Writing 20 cards',
      'Saving to your deck',
    ]);
  });

  it('stays vague rather than inventing a count', () => {
    expect(jobStages('flashcards')[1]).toBe('Writing your cards');
  });

  it('has a stage list for every kind', () => {
    for (const kind of ['flashcards', 'quiz', 'test', 'summary', 'import'] as const) {
      expect(jobStages(kind, 5).length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('jobArtefactLabel', () => {
  it('pluralises honestly', () => {
    expect(jobArtefactLabel('flashcards', 1)).toBe('1 flashcard');
    expect(jobArtefactLabel('flashcards', 20)).toBe('20 flashcards');
  });

  it('drops the number when there is none', () => {
    expect(jobArtefactLabel('flashcards')).toBe('Your flashcards');
    expect(jobArtefactLabel('flashcards', 0)).toBe('Your flashcards');
  });
});

describe('stageIndexFor', () => {
  it('starts at the first stage', () => {
    expect(stageIndexFor(0, 3)).toBe(0);
  });

  it('never runs past the last stage', () => {
    expect(stageIndexFor(JOB_TIME_BUDGET_MS * 10, 3)).toBe(2);
    expect(stageIndexFor(0, 3, 5)).toBe(2);
  });

  it('prefers a server fraction over the clock', () => {
    expect(stageIndexFor(0, 3, 0.7)).toBe(2);
  });
});

describe('percentFor', () => {
  it('never claims completion before the work is done', () => {
    // The failure this wave exists to beat: a tray that says 100% (or
    // "Completed") on work that has not landed.
    expect(percentFor(job({ status: 'running' }), NOW + JOB_TIME_BUDGET_MS * 4)).toBe(95);
    expect(percentFor(job({ status: 'running', progress: 1 }), NOW)).toBe(95);
  });

  it('is 100 only once the job reports done', () => {
    expect(percentFor(job({ status: 'done' }), NOW)).toBe(100);
  });

  it('is 0 for a job that stopped badly', () => {
    expect(percentFor(job({ status: 'failed' }), NOW)).toBe(0);
    expect(percentFor(job({ status: 'lost' }), NOW)).toBe(0);
  });

  it('tracks elapsed time when the server gives no fraction', () => {
    expect(percentFor(job({ status: 'running' }), NOW + JOB_TIME_BUDGET_MS / 2)).toBe(50);
  });
});

describe('formatElapsed', () => {
  it('renders m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_000)).toBe('0:09');
    expect(formatElapsed(95_000)).toBe('1:35');
  });

  it('never goes negative on a clock that jumped', () => {
    expect(formatElapsed(-5000)).toBe('0:00');
  });
});

describe('jobSheetState while running', () => {
  it('offers only a way to stop watching, never a way to cancel the work', () => {
    const state = jobSheetState(job({ status: 'running' }), NOW + 5_000);
    expect(state.actions).toEqual(['stop-watching']);
    expect(jobActionLabel('stop-watching')).toBe(KEEP_WORKING_COPY);
    expect(state.tone).toBe('running');
  });

  it('shows the current stage', () => {
    const state = jobSheetState(job({ status: 'running' }), NOW + 1_000);
    expect(state.detail).toBe('Reading your notes');
    expect(state.stageIndex).toBe(0);
  });

  it('prefers a stage the server named', () => {
    const state = jobSheetState(job({ status: 'running', stage: 'Saving to your deck' }), NOW + 1_000);
    expect(state.detail).toBe('Saving to your deck');
  });

  it('names the artefact and its source in the headline', () => {
    expect(jobSheetState(job({ status: 'running' }), NOW).headline).toBe(
      '20 flashcards · Foundations of AI'
    );
  });

  it('after the 90 s budget offers Keep waiting and a way out, and says it is still running', () => {
    const state = jobSheetState(job({ status: 'running' }), NOW + JOB_TIME_BUDGET_MS);
    expect(state.overBudget).toBe(true);
    expect(state.actions).toEqual(['keep-waiting', 'stop-watching']);
    // Never Retry while the first attempt is still running: it cannot be
    // cancelled, so a retry would charge twice and produce two decks.
    expect(state.actions).not.toContain('retry');
    expect(state.detail).toBe(OVER_BUDGET_COPY);
    expect(state.detail).toContain('still running');
    expect(state.detail).toContain('charged once');
  });

  it('an extended budget puts the prompt away instead of closing the sheet', () => {
    // "Keep waiting" adds another budget; without that the prompt would come
    // straight back on the next tick.
    const state = jobSheetState(
      job({ status: 'running' }),
      NOW + JOB_TIME_BUDGET_MS + 1_000,
      JOB_TIME_BUDGET_MS * 2
    );
    expect(state.overBudget).toBe(false);
    expect(state.actions).toEqual(['stop-watching']);
  });
});

describe('jobSheetState when finished', () => {
  it('reports what was saved, and offers to open it', () => {
    const state = jobSheetState(
      job({
        status: 'done',
        resultCount: 18,
        artifact: { type: 'deck', id: 'd1', name: 'From: Foundations of AI' },
      }),
      NOW + 30_000
    );
    // 18 saved, not the 20 that were asked for — the count is of artefacts
    // that exist, never of what was merely generated.
    expect(state.headline).toBe('18 flashcards ready');
    expect(state.detail).toBe('Saved to "From: Foundations of AI"');
    expect(state.actions).toEqual(['open', 'dismiss']);
    expect(state.percent).toBe(100);
  });

  it('always offers Open, because every finished job now has somewhere to go', () => {
    // The quiz used to finish with "Dismiss" as its only button. A job with no
    // artefact opens its own card on Home, which is a true destination.
    expect(jobSheetState(job({ status: 'done' }), NOW).actions).toEqual(['open', 'dismiss']);
  });

  it('reads the artefact off the persisted savedRef when the run is gone', () => {
    // After a cold start the runner's `artifact` is gone; `savedRef` was
    // written when the save landed and is what survives.
    const state = jobSheetState(
      job({ status: 'done', savedRef: { type: 'deck', id: 'd1', name: 'From: SDOH' } }),
      NOW
    );
    expect(state.detail).toBe('Saved to "From: SDOH"');
  });

  it('states the error verbatim and claims nothing about the credit', () => {
    const state = jobSheetState(job({ status: 'failed', error: 'AI is off right now.' }), NOW);
    expect(state.detail).toBe('AI is off right now.');
    // A job can fail after the AI answered (the save step), where the credit
    // was honestly spent — so the sheet never asserts a refund it cannot know.
    expect(state.detail).not.toMatch(/refund/i);
    expect(state.actions).toEqual(['retry', 'dismiss']);
    expect(state.tone).toBe('failed');
  });

  it('does not claim a failure it cannot know about, in one line the card can show', () => {
    const state = jobSheetState(job({ status: 'lost' }), NOW);
    expect(state.headline).toBe('We lost track of this one');
    expect(state.detail).toBe(
      'The app closed before it finished — check your library before retrying.'
    );
    // The Home card gives this three lines. Longer than this was cut
    // mid-word ("check your library bef…"), losing the instruction.
    expect(state.detail.length).toBeLessThanOrEqual(120);
  });

  it('a job the watcher lost contact with says so, and still points at the library', () => {
    const state = jobSheetState(
      job({ status: 'lost', error: "We couldn't reach the server to check on it." }),
      NOW
    );
    expect(state.detail).toBe(
      "We couldn't reach the server to check on it. Check your library before retrying."
    );
    expect(state.tone).toBe('failed');
  });
});

describe('jobArtifactLink', () => {
  it('round-trips through the deep-link parser the handler uses', () => {
    const link = jobArtifactLink({ type: 'deck', id: 'deck-1' });
    expect(link).toBe('lanternstudy://deck/deck-1');
    expect(parseDeepLink(link as string)).toMatchObject({ type: 'deck', id: 'deck-1' });
  });

  it('links a note', () => {
    expect(parseDeepLink(jobArtifactLink({ type: 'note', id: 'n1' }) as string)).toMatchObject({
      type: 'note',
      id: 'n1',
    });
  });

  it('links the daily quiz, which has no id of its own', () => {
    // The device run tapped a finished quiz's notification and landed back on
    // the note editor, because the payload was empty. The quiz is saved under
    // `daily` and the link resolves to the dashboard panel it lives in.
    const link = jobArtifactLink({ type: 'quiz', id: 'daily', name: "Today's quiz" });
    expect(link).toBe('lanternstudy://quiz/daily');
    expect(parseDeepLink(link as string)).toMatchObject({ type: 'quiz', id: 'daily' });
  });

  it('carries a test name, because the screen that shows one requires it', () => {
    const link = jobArtifactLink({ type: 'test', id: 't1', name: 'Week 3' }) as string;
    expect(parseDeepLink(link)).toMatchObject({ type: 'test', id: 't1', extra: { name: 'Week 3' } });
  });

  it('has no link for an artefact with no id at all', () => {
    expect(jobArtifactLink(undefined)).toBeNull();
    expect(jobArtifactLink({ type: 'quiz', id: '' })).toBeNull();
    expect(jobArtifactLink({ type: 'deck', id: '' })).toBeNull();
  });
});

describe('jobResultLink', () => {
  it('is the artefact when there is one', () => {
    expect(jobResultLink(job({ status: 'done', artifact: { type: 'deck', id: 'd1' } }))).toBe(
      'lanternstudy://deck/d1'
    );
  });

  it('falls back to the persisted savedRef', () => {
    expect(jobResultLink(job({ status: 'done', savedRef: { type: 'note', id: 'n1' } }))).toBe(
      'lanternstudy://note/n1'
    );
  });

  it('is the job itself when nothing named an artefact', () => {
    // An old server's bare "completed", or a push this device knows nothing
    // about. The link resolves against the store, and lands on Home if it
    // cannot — never on whatever screen happened to be open.
    expect(jobResultLink(job({ status: 'done' }))).toBe('lanternstudy://jobs/j1');
  });
});

describe('jobProgressView — F4: one value behind the subtitle, the ticks and the bar', () => {
  it('the subtitle IS the active checklist row', () => {
    for (const at of [0, 5_000, 30_000, 60_000, JOB_TIME_BUDGET_MS * 2]) {
      const state = jobSheetState(job({ status: 'running' }), NOW + at);
      expect(state.detail === OVER_BUDGET_COPY || state.detail === state.stages[state.stageIndex]).toBe(
        true
      );
    }
  });

  it('never shows a percent from a different stage than the one ticked', () => {
    // The device run showed "Saving to your deck" at 11% while the checklist
    // still had "Reading your notes" active.
    for (const progress of [0, 0.1, 0.3, 0.5, 0.9, 1]) {
      const view = jobProgressView(job({ status: 'running', progress }), NOW);
      const [floor, ceiling] = JOB_STAGE_BANDS[view.stageIndex];
      expect(view.percent).toBeGreaterThanOrEqual(floor);
      expect(view.percent).toBeLessThanOrEqual(Math.min(95, ceiling));
    }
  });

  it("takes the furthest step any signal claims, so it never goes backwards", () => {
    const view = jobProgressView(
      job({ status: 'running', serverStage: 'saving', progress: 0.1 }),
      NOW
    );
    expect(view.stage).toBe('Saving to your deck');
    expect(view.stageIndex).toBe(2);
    expect(view.percent).toBe(85);
  });

  it('maps the server stage words onto the three steps the sheet shows', () => {
    const at = (serverStage: string) =>
      jobProgressView(job({ status: 'running', serverStage }), NOW).stage;
    expect(at('queued')).toBe('Reading your notes');
    expect(at('reading')).toBe('Reading your notes');
    expect(at('generating')).toBe('Writing 20 cards');
    expect(at('saving')).toBe('Saving to your deck');
  });

  it('an old server — status only, no stage — still lands on one consistent stage', () => {
    // Nothing but the clock to go on. The subtitle, the tick and the bar are
    // all derived from that one number rather than from three of them.
    const view = jobProgressView(job({ status: 'running' }), NOW + JOB_TIME_BUDGET_MS / 2);
    expect(view.stageIndex).toBe(1);
    expect(view.stage).toBe('Writing 20 cards');
    expect(view.percent).toBe(50);
    const state = jobSheetState(job({ status: 'running' }), NOW + JOB_TIME_BUDGET_MS / 2);
    expect(state.detail).toBe(view.stage);
    expect(state.stageIndex).toBe(view.stageIndex);
    expect(state.percent).toBe(view.percent);
  });

  it('a runner stage that is not one of this list is ignored rather than shown', () => {
    const state = jobSheetState(
      job({ status: 'running', stage: 'Doing something else entirely' }),
      NOW + 1_000
    );
    expect(state.detail).toBe(state.stages[state.stageIndex]);
  });
});

describe('jobNotification', () => {
  it('titles with the artefact and the material, not "generation complete"', () => {
    const notice = jobNotification(
      job({
        status: 'done',
        resultCount: 20,
        artifact: { type: 'deck', id: 'd1', name: 'From: Foundations of AI' },
      })
    );
    expect(notice?.title).toBe('20 flashcards ready · Foundations of AI');
    expect(notice?.url).toBe('lanternstudy://deck/d1');
  });

  it('tells the student honestly when it failed', () => {
    const notice = jobNotification(job({ status: 'failed', error: 'Network unavailable.' }));
    expect(notice?.title).toBe("Couldn't finish · Foundations of AI");
    expect(notice?.body).toBe('Network unavailable.');
    expect(notice?.body).not.toMatch(/refund/i);
    // Never a dead tap: it opens the job's own card, where Try again is.
    expect(notice?.url).toBe('lanternstudy://jobs/j1');
    expect(notice?.jobId).toBe('j1');
  });

  it('says nothing while the job is still running', () => {
    expect(jobNotification(job({ status: 'running' }))).toBeNull();
    expect(jobNotification(job({ status: 'lost' }))).toBeNull();
  });
});

describe('a generation that was made but never filed', () => {
  const holding = job({
    status: 'failed',
    error: "We couldn't save this to your library. Check your connection and try again.",
    pendingSave: {
      kind: 'deck',
      deckName: 'From: SDOH',
      cards: [{ front: 'q', back: 'a' }],
    },
  });

  it('offers to save it instead of offering to generate it again', () => {
    const state = jobSheetState(holding, NOW + 5_000);
    expect(state.actions).toEqual(['save-to-library', 'dismiss']);
    expect(state.actions).not.toContain('retry');
    expect(jobActionLabel('save-to-library')).toBe('Save to library');
  });

  it('says nothing was lost, because nothing was', () => {
    const state = jobSheetState(holding, NOW + 5_000);
    expect(state.headline).toBe('Ready to save');
    expect(state.detail).toContain('Nothing was lost');
  });

  it('says the same after a cold start marked it lost', () => {
    const state = jobSheetState({ ...holding, status: 'lost' }, NOW + 5_000);
    expect(state.actions).toEqual(['save-to-library', 'dismiss']);
  });

  it('goes back to a plain failure once the material has landed', () => {
    const state = jobSheetState(
      { ...holding, savedRef: { type: 'deck', id: 'd1' }, pendingSave: undefined },
      NOW + 5_000
    );
    expect(state.actions).toEqual(['retry', 'dismiss']);
  });
});

describe('a saved note quiz', () => {
  it('links to the test it became, not to the daily quiz panel', () => {
    const done = job({
      kind: 'quiz',
      status: 'done',
      resultCount: 5,
      artifact: { type: 'test', id: 'test-7', name: 'Quiz · SDOH' },
    });
    const link = jobResultLink(done);
    expect(link).toBe('lanternstudy://test/test-7?name=Quiz%20%C2%B7%20SDOH');
    const parsed = parseDeepLink(link);
    expect(parsed?.type).toBe('test');
    expect(parsed?.id).toBe('test-7');
    expect(parsed?.extra?.name).toBe('Quiz · SDOH');
    expect(jobNotification(done)?.url).toBe(link);
  });
});
