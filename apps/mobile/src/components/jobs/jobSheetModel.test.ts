import { parseDeepLink } from '@lantern/shared/linking';
import { JOB_TIME_BUDGET_MS, createJob, type TrackedJob } from '../../stores/jobsCore';
import {
  JOB_STAGE_BANDS,
  KEEP_WORKING_COPY,
  NO_NOTIFICATIONS_COPY,
  UNVERIFIED_NOTIFICATIONS_COPY,
  OVER_BUDGET_COPY,
  STILL_WORKING_COPY,
  WAITING_FOR_CONNECTION_COPY,
  formatElapsed,
  jobActionLabel,
  SHEET_DISMISS_DISTANCE,
  SHEET_DRAG_SLOP,
  shouldClaimSheetDrag,
  shouldDismissSheet,
  jobArtefactLabel,
  jobArtifactLink,
  jobNotification,
  jobProgressView,
  jobResultLink,
  jobSheetState,
  jobStages,
  jobStagesFor,
  jobDoneLabel,
  jobRunningHeadline,
  percentFor,
  stageIndexFor,
} from './jobSheetModel';
import { PUSH_SENT_COPY } from '../../utils/pushDiagnostics';

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
  it('starts at the first stage when the server has said nothing', () => {
    expect(stageIndexFor(3)).toBe(0);
  });

  it('never runs past the last stage', () => {
    expect(stageIndexFor(3, 5)).toBe(2);
    expect(stageIndexFor(3, 1)).toBe(2);
  });

  it('reads the server fraction, and nothing else', () => {
    expect(stageIndexFor(3, 0.7)).toBe(2);
    expect(stageIndexFor(3, 0.5)).toBe(1);
  });
});

describe('percentFor', () => {
  it('never claims completion before the work is done', () => {
    // The failure this wave exists to beat: a tray that says 100% (or
    // "Completed") on work that has not landed.
    expect(percentFor(job({ status: 'running', progress: 1 }))).toBe(95);
  });

  it('is 100 only once the job reports done', () => {
    expect(percentFor(job({ status: 'done' }))).toBe(100);
  });

  it('is 0 for a job that stopped badly', () => {
    expect(percentFor(job({ status: 'failed' }))).toBe(0);
    expect(percentFor(job({ status: 'lost' }))).toBe(0);
  });

  it('does not move with the clock — F7', () => {
    // Airplane mode walked the bar 8% → 64% → 93% through "Writing 10 cards"
    // while no request could be in flight. Nothing but the server moves it.
    const running = job({ status: 'running' });
    expect(percentFor(running)).toBe(0);
    expect(percentFor({ ...running, startedAt: NOW - JOB_TIME_BUDGET_MS * 4 })).toBe(0);
  });

  it('rests on the floor of the furthest step something actually reported', () => {
    expect(percentFor(job({ status: 'running', serverStage: 'generating' }))).toBe(45);
    expect(percentFor(job({ status: 'running', serverStage: 'saving' }))).toBe(85);
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
    const state = jobSheetState(job({ status: 'running', serverStage: 'reading' }), NOW + 1_000);
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
    // The way out is on every running sheet, over budget or not: the device
    // run found one that only the hardware Back key would close (F6).
    expect(
      jobSheetState(job({ status: 'running' }), NOW + 1_000).actions
    ).toContain('stop-watching');
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
      const state = jobSheetState(job({ status: 'running', serverStage: 'generating' }), NOW + at);
      expect(state.detail === OVER_BUDGET_COPY || state.detail === state.stages[state.stageIndex]).toBe(
        true
      );
    }
  });

  it('never shows a percent from a different stage than the one ticked', () => {
    // The device run showed "Saving to your deck" at 11% while the checklist
    // still had "Reading your notes" active.
    for (const progress of [0, 0.1, 0.3, 0.5, 0.9, 1]) {
      const view = jobProgressView(job({ status: 'running', progress }));
      const [floor, ceiling] = JOB_STAGE_BANDS[view.stageIndex];
      expect(view.percent).toBeGreaterThanOrEqual(floor);
      expect(view.percent).toBeLessThanOrEqual(Math.min(95, ceiling));
    }
  });

  it("takes the furthest step any signal claims, so it never goes backwards", () => {
    const view = jobProgressView(job({ status: 'running', serverStage: 'saving', progress: 0.1 }));
    expect(view.stage).toBe('Saving to your deck');
    expect(view.stageIndex).toBe(2);
    expect(view.percent).toBe(85);
  });

  it('maps the server stage words onto the three steps the sheet shows', () => {
    const at = (serverStage: string) =>
      jobProgressView(job({ status: 'running', serverStage })).stage;
    expect(at('queued')).toBe('Reading your notes');
    expect(at('reading')).toBe('Reading your notes');
    expect(at('generating')).toBe('Writing 20 cards');
    expect(at('saving')).toBe('Saving to your deck');
  });

  it('a server fraction alone lands on one consistent stage', () => {
    // The subtitle, the tick and the bar are all derived from that one number
    // rather than from three of them.
    const view = jobProgressView(job({ status: 'running', progress: 0.5 }));
    expect(view.stageIndex).toBe(1);
    expect(view.stage).toBe('Writing 20 cards');
    expect(view.percent).toBe(50);
    const state = jobSheetState(job({ status: 'running', progress: 0.5 }), NOW + 10_000);
    expect(state.detail).toBe(view.stage);
    expect(state.stageIndex).toBe(view.stageIndex);
    expect(state.percent).toBe(view.percent);
  });

  it('says there is no news rather than inventing some — F7', () => {
    // Nothing has reported: not the server, not a runner. The bar holds at
    // the floor of the first step and the subtitle names the situation.
    const state = jobSheetState(job({ status: 'running' }), NOW + 40_000);
    expect(state.waiting).toBe(true);
    expect(state.detail).toBe(STILL_WORKING_COPY);
    expect(state.percent).toBe(0);

    const offline = jobSheetState(job({ status: 'running' }), NOW + 40_000, undefined, {
      offline: true,
    });
    expect(offline.detail).toBe(WAITING_FOR_CONNECTION_COPY);
    expect(offline.percent).toBe(0);
  });

  it('stops waiting the moment the server says anything', () => {
    const state = jobSheetState(job({ status: 'running', serverStage: 'generating' }), NOW);
    expect(state.waiting).toBe(false);
    expect(state.detail).toBe('Writing 20 cards');
  });

  it('a runner stage counts as news — the client IS doing that step', () => {
    const state = jobSheetState(job({ status: 'running', stage: 'Saving to your deck' }), NOW);
    expect(state.waiting).toBe(false);
    expect(state.detail).toBe('Saving to your deck');
  });
});

describe('a device that cannot be notified — F6', () => {
  it('stops promising a notification it cannot deliver, and offers to fix it', () => {
    const state = jobSheetState(job({ status: 'running' }), NOW + 1_000, undefined, {
      notificationsOff: true,
    });
    expect(state.actions).toContain('enable-notifications');
    expect(jobActionLabel('stop-watching', { notificationsOff: true })).toBe(NO_NOTIFICATIONS_COPY);
    expect(jobActionLabel('stop-watching', { notificationsOff: true })).not.toContain(
      "we'll tell you"
    );
    expect(jobActionLabel('enable-notifications')).toBe('Turn on notifications');
  });

  it('keeps the promise when notifications are on', () => {
    const state = jobSheetState(job({ status: 'running' }), NOW + 1_000);
    expect(state.actions).not.toContain('enable-notifications');
    expect(jobActionLabel('stop-watching')).toBe(KEEP_WORKING_COPY);
  });

  it('a runner stage that is not one of this list is ignored rather than shown', () => {
    const state = jobSheetState(
      job({ status: 'running', stage: 'Doing something else entirely' }),
      NOW + 1_000
    );
    // Not one of the three steps, so it says nothing about which step is
    // running — and the sheet reports no news rather than a word off a list
    // the checklist does not share.
    expect(state.stages).not.toContain(state.detail);
    expect(state.detail).toBe(STILL_WORKING_COPY);
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


// ─────────────────────────────────────────────────────────────
// D6 — the sheet closes on a swipe down, not only on a button
// ─────────────────────────────────────────────────────────────

describe('swiping the progress sheet away', () => {
  it('claims an unmistakable downward drag', () => {
    expect(shouldClaimSheetDrag(20, 2)).toBe(true);
  });

  it('leaves a tap alone, so the sheet\'s buttons still work', () => {
    // Every action on this sheet is a Pressable; a gesture that claimed on
    // contact would make "Save to library" untappable.
    expect(shouldClaimSheetDrag(0, 0)).toBe(false);
    expect(shouldClaimSheetDrag(SHEET_DRAG_SLOP, 0)).toBe(false);
  });

  it('leaves an upward or sideways drag alone', () => {
    expect(shouldClaimSheetDrag(-30, 0)).toBe(false);
    expect(shouldClaimSheetDrag(10, 40)).toBe(false);
  });

  it('dismisses past the threshold and springs back short of it', () => {
    expect(shouldDismissSheet(SHEET_DISMISS_DISTANCE + 1)).toBe(true);
    expect(shouldDismissSheet(SHEET_DISMISS_DISTANCE)).toBe(false);
    expect(shouldDismissSheet(10)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// What the sheet says about the notification itself
// ─────────────────────────────────────────────────────────────

describe('the push audit line', () => {
  it('says nothing while the job is still running', () => {
    expect(jobSheetState(job(), NOW).pushNote).toBeNull();
  });

  it('says nothing about a finished job whose record carries no audit', () => {
    expect(jobSheetState(job({ status: 'done', resultCount: 3 }), NOW).pushNote).toBeNull();
  });

  it('confirms a push that went out', () => {
    const state = jobSheetState(
      job({
        status: 'done',
        resultCount: 3,
        pushAudit: { attemptedAt: '2026-09-05T10:00:00.000Z', tokenCount: 1 },
      }),
      NOW
    );
    expect(state.pushNote).toBe(PUSH_SENT_COPY);
  });

  it('names the reason in plain words when one was skipped', () => {
    const state = jobSheetState(
      job({
        status: 'done',
        resultCount: 3,
        pushAudit: { attemptedAt: '2026-09-05T10:00:00.000Z', skippedReason: 'no_token' },
      }),
      NOW
    );
    expect(state.pushNote).toBe('Push skipped: no push token on this device');
    expect(state.pushNote).not.toContain('no_token');
  });

  it('reports it on a failure too', () => {
    const state = jobSheetState(
      job({
        status: 'failed',
        error: 'The generation failed.',
        pushAudit: { attemptedAt: '2026-09-05T10:00:00.000Z', skippedReason: 'prefs_off' },
      }),
      NOW
    );
    expect(state.pushNote).toBe('Push skipped: notifications are off in Settings');
  });
});

describe('the promise the sheet makes about being told', () => {
  const running = () => job({ status: 'running' });

  it('promises only when delivery is verified', () => {
    const state = jobSheetState(running(), NOW, JOB_TIME_BUDGET_MS, { notifications: 'ready' });
    expect(jobActionLabel('stop-watching', { notifications: 'ready' })).toBe(KEEP_WORKING_COPY);
    expect(state.actions).not.toContain('enable-notifications');
  });

  it('drops the promise and offers a fix when delivery is known to be off', () => {
    const state = jobSheetState(running(), NOW, JOB_TIME_BUDGET_MS, { notifications: 'off' });
    expect(jobActionLabel('stop-watching', { notifications: 'off' })).toBe(NO_NOTIFICATIONS_COPY);
    expect(state.actions).toContain('enable-notifications');
  });

  it('neither promises nor accuses when the server could not be asked', () => {
    const state = jobSheetState(running(), NOW, JOB_TIME_BUDGET_MS, { notifications: 'unknown' });
    const label = jobActionLabel('stop-watching', { notifications: 'unknown' });
    expect(label).toBe(UNVERIFIED_NOTIFICATIONS_COPY);
    expect(label).not.toMatch(/we'll tell you/i);
    expect(label).not.toMatch(/notifications are off/i);
    // Nothing to turn on: we do not know that anything is off.
    expect(state.actions).not.toContain('enable-notifications');
  });
});


describe('a count that is a ceiling (build 168)', () => {
  const test = (overrides: Partial<TrackedJob> = {}): TrackedJob => ({
    ...createJob({
      id: 'j-test',
      userId: 'u1',
      kind: 'test',
      sourceTitle: 'SDOH',
      requestedCount: 10,
      requestedCountIsMax: true,
      now: NOW,
    }),
    ...overrides,
  });

  it('says "up to" in the checklist rather than promising ten', () => {
    expect(jobStagesFor(test())[1]).toBe('Writing up to 10 questions');
    expect(jobStages('test', 10)[1]).toBe('Writing 10 questions');
  });

  it('does not put the ceiling in the running headline', () => {
    // "10-question test · SDOH" over work that saved five was the promise the
    // sheet could not keep.
    expect(jobRunningHeadline(test({ status: 'running' }))).toBe('Your test · SDOH');
  });

  it('states the SAVED count once there is one', () => {
    const done = test({
      status: 'done',
      resultCount: 5,
      artifact: { type: 'test', id: 't1', name: 'Test · SDOH' },
    });
    expect(jobDoneLabel(done)).toBe('5-question test');
    expect(jobSheetState(done, NOW + 20_000).headline).toBe('5-question test ready');
    expect(jobNotification(done)?.title).toBe('5-question test ready · SDOH');
  });

  it('never borrows the requested count for a finished job', () => {
    const done = test({
      status: 'done',
      artifact: { type: 'test', id: 't1', name: 'Test · SDOH' },
    });
    expect(jobNotification(done)?.title).toBe('Your test ready · SDOH');
    expect(jobDoneLabel(done)).not.toContain('10');
  });

  it('counts what the save recorded when the runner reported no count', () => {
    const done = test({
      status: 'done',
      savedCount: 7,
      artifact: { type: 'test', id: 't1' },
    });
    expect(jobDoneLabel(done)).toBe('7-question test');
  });
});
