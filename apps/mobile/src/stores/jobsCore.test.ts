import {
  JOBS_STORAGE_PREFIX,
  JOB_TIME_BUDGET_MS,
  MAX_TRACKED_JOBS,
  RECENT_JOB_WINDOW_MS,
  claimNotification,
  claimUsage,
  createJob,
  dismissJob,
  findJob,
  isTerminal,
  jobsKey,
  jobsOwnedBy,
  parseJobs,
  patchJob,
  planResume,
  toJobStatusSnapshot,
  claimSave,
  findJobByAnyId,
  isPersistedId,
  planDeckSave,
  planSave,
  pruneJobs,
  runningJobs,
  upsertJob,
  visibleJobs,
  type TrackedJob,
  planHydration,
  planServerSettle,
  isSyncOpOrphanedByDeckDelete,
  hasUnsavedGeneration,
  planRetry,
  UNSAVED_GENERATION_ERROR,
} from './jobsCore';

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

describe('jobsKey', () => {
  it('scopes storage per user, as pending results are', () => {
    expect(jobsKey('u1')).toBe(`${JOBS_STORAGE_PREFIX}:u1`);
    expect(jobsKey('u1')).not.toBe(jobsKey('u2'));
  });
});

describe('parseJobs', () => {
  it('returns [] for null, corrupt JSON and non-arrays', () => {
    expect(parseJobs(null)).toEqual([]);
    expect(parseJobs('not json')).toEqual([]);
    expect(parseJobs('{"a":1}')).toEqual([]);
  });

  it('drops entries that are not job records', () => {
    const raw = JSON.stringify([job(), null, { id: 'x' }, { status: 'done' }]);
    expect(parseJobs(raw)).toHaveLength(1);
  });
});

describe('upsertJob', () => {
  it('replaces by id rather than duplicating', () => {
    const jobs = upsertJob([job()], job({ status: 'running' }));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('running');
  });

  it('orders newest first', () => {
    const older = job({ id: 'old', startedAt: NOW - 5000 });
    const jobs = upsertJob([older], job({ id: 'new', startedAt: NOW }));
    expect(jobs.map((j) => j.id)).toEqual(['new', 'old']);
  });
});

describe('patchJob', () => {
  it('applies a patch and stamps updatedAt', () => {
    const jobs = patchJob([job()], 'j1', { status: 'running' }, NOW + 10);
    expect(jobs[0].status).toBe('running');
    expect(jobs[0].updatedAt).toBe(NOW + 10);
  });

  it('leaves other jobs alone', () => {
    const jobs = patchJob([job(), job({ id: 'j2' })], 'j1', { status: 'running' }, NOW);
    expect(jobs[1].status).toBe('queued');
  });

  it('never moves a terminal job back into flight', () => {
    // A poll response landing after the in-process await already reported the
    // job done would otherwise re-run every "it finished" side effect.
    const done = job({ status: 'done' });
    const jobs = patchJob([done], 'j1', { status: 'running', stage: 'late' }, NOW + 1);
    expect(jobs[0].status).toBe('done');
    expect(jobs[0].stage).toBe('late');
  });

  it('still records flags on a terminal job', () => {
    const jobs = patchJob([job({ status: 'done' })], 'j1', { notified: true }, NOW);
    expect(jobs[0].notified).toBe(true);
  });
});

describe('claimUsage', () => {
  it('claims once and never again', () => {
    const first = claimUsage([job()], 'j1', NOW);
    expect(first.claimed).toBe(true);
    expect(findJob(first.jobs, 'j1')?.usageApplied).toBe(true);

    const second = claimUsage(first.jobs, 'j1', NOW + 1);
    expect(second.claimed).toBe(false);
    expect(second.jobs).toBe(first.jobs);
  });

  it('does not claim for an unknown job', () => {
    expect(claimUsage([job()], 'nope', NOW).claimed).toBe(false);
  });
});

describe('claimNotification', () => {
  it('claims once, so one job never notifies twice', () => {
    const first = claimNotification([job({ status: 'done' })], 'j1', NOW);
    expect(first.claimed).toBe(true);
    expect(claimNotification(first.jobs, 'j1', NOW).claimed).toBe(false);
  });
});

describe('jobsOwnedBy', () => {
  it('keeps only this account, never assuming an unowned entry', () => {
    const mine = job({ id: 'a', userId: 'u1' });
    const theirs = job({ id: 'b', userId: 'u2' });
    const unowned = job({ id: 'c', userId: '' });
    expect(jobsOwnedBy([mine, theirs, unowned], 'u1').map((j) => j.id)).toEqual(['a']);
  });
});

describe('pruneJobs', () => {
  it('keeps running jobs however old', () => {
    const stale = job({ status: 'running', updatedAt: NOW - RECENT_JOB_WINDOW_MS * 3 });
    expect(pruneJobs([stale], NOW)).toHaveLength(1);
  });

  it('drops finished jobs past the window', () => {
    const old = job({ status: 'done', updatedAt: NOW - RECENT_JOB_WINDOW_MS - 1 });
    const fresh = job({ id: 'j2', status: 'done', updatedAt: NOW });
    expect(pruneJobs([old, fresh], NOW).map((j) => j.id)).toEqual(['j2']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_TRACKED_JOBS + 5 }, (_, i) =>
      job({ id: `j${i}`, startedAt: NOW - i })
    );
    expect(pruneJobs(many, NOW)).toHaveLength(MAX_TRACKED_JOBS);
  });
});

describe('visibleJobs', () => {
  it('lists in-flight work and recent results, newest first', () => {
    const running = job({ id: 'run', status: 'running', startedAt: NOW });
    const recent = job({ id: 'recent', status: 'done', startedAt: NOW - 1000, updatedAt: NOW });
    const ancient = job({
      id: 'ancient',
      status: 'done',
      startedAt: NOW - RECENT_JOB_WINDOW_MS * 2,
      updatedAt: NOW - RECENT_JOB_WINDOW_MS * 2,
    });
    expect(visibleJobs([ancient, recent, running], NOW).map((j) => j.id)).toEqual([
      'run',
      'recent',
    ]);
  });
});

describe('planResume', () => {
  it('resumes a job that has a server id', () => {
    const plan = planResume([job({ status: 'running', serverJobId: 'srv-1' })], NOW);
    expect(plan.resume).toEqual(['j1']);
    expect(plan.lost).toEqual([]);
    expect(findJob(plan.jobs, 'j1')?.status).toBe('running');
  });

  it('stops watching a resumed job — the sheet is gone with the process', () => {
    const plan = planResume([job({ status: 'running', serverJobId: 'srv-1', watching: true })], NOW);
    expect(findJob(plan.jobs, 'j1')?.watching).toBe(false);
  });

  it('marks a job with no server id lost, NOT failed', () => {
    // "Failed" would be a claim about the server the client cannot make.
    const plan = planResume([job({ status: 'running' })], NOW);
    expect(plan.lost).toEqual(['j1']);
    expect(findJob(plan.jobs, 'j1')?.status).toBe('lost');
  });

  it('leaves finished jobs untouched', () => {
    const plan = planResume([job({ status: 'done' })], NOW);
    expect(plan.resume).toEqual([]);
    expect(plan.lost).toEqual([]);
    expect(findJob(plan.jobs, 'j1')?.status).toBe('done');
  });
});

describe('planHydration', () => {
  it('keeps a live in-memory job over its persisted copy, never marking it lost', () => {
    const live = job({ status: 'running' });
    const plan = planHydration([live], [{ ...live, status: 'running' }], 'u1', NOW);
    expect(plan.lost).toEqual([]);
    expect(plan.resume).toEqual([]);
    expect(findJob(plan.jobs, 'j1')?.status).toBe('running');
    expect(findJob(plan.jobs, 'j1')?.watching).toBe(true);
  });

  it('still resumes or loses the stored jobs this process never saw', () => {
    const live = job({ status: 'running' });
    const plan = planHydration(
      [live],
      [
        job({ id: 'j2', status: 'running', serverJobId: 'srv-2', startedAt: NOW - 1 }),
        job({ id: 'j3', status: 'running', startedAt: NOW - 2 }),
      ],
      'u1',
      NOW
    );
    expect(plan.resume).toEqual(['j2']);
    expect(plan.lost).toEqual(['j3']);
    expect(plan.jobs.map((j) => j.id)).toEqual(['j1', 'j2', 'j3']);
  });

  it('drops in-memory jobs that belong to another account', () => {
    const plan = planHydration([job({ userId: 'someone-else' })], [], 'u1', NOW);
    expect(plan.jobs).toEqual([]);
  });
});

describe('status helpers', () => {
  it('knows which statuses have stopped', () => {
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('done')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('lost')).toBe(true);
  });

  it('lists what is still in flight', () => {
    expect(runningJobs([job(), job({ id: 'j2', status: 'done' })]).map((j) => j.id)).toEqual(['j1']);
  });
});

describe('dismissJob', () => {
  it('removes only that job', () => {
    expect(dismissJob([job(), job({ id: 'j2' })], 'j1').map((j) => j.id)).toEqual(['j2']);
  });
});

describe('createJob', () => {
  it('starts queued, watched, uncharged and unnotified', () => {
    const fresh = createJob({
      id: 'x',
      userId: 'u1',
      kind: 'quiz',
      sourceTitle: 'Note',
      now: NOW,
    });
    expect(fresh).toMatchObject({
      status: 'queued',
      watching: true,
      usageApplied: false,
      notified: false,
      startedAt: NOW,
      updatedAt: NOW,
    });
  });
});

describe('the client time budget', () => {
  it('is the 90 s the sheet promises against', () => {
    expect(JOB_TIME_BUDGET_MS).toBe(90_000);
  });
});

describe('toJobStatusSnapshot', () => {
  it('maps the stage machine onto the three outcomes', () => {
    expect(toJobStatusSnapshot({ stage: 'queued' }).status).toBe('queued');
    expect(toJobStatusSnapshot({ stage: 'reading' }).status).toBe('running');
    expect(toJobStatusSnapshot({ stage: 'generating' }).status).toBe('running');
    expect(toJobStatusSnapshot({ stage: 'saving' }).status).toBe('running');
    expect(toJobStatusSnapshot({ stage: 'done' }).status).toBe('completed');
    expect(toJobStatusSnapshot({ stage: 'failed' }).status).toBe('failed');
    // A job the server stopped is a failure the student can retry, not a
    // separate state the sheet would have no copy for.
    expect(toJobStatusSnapshot({ stage: 'timed_out' }).status).toBe('failed');
  });

  it('falls back to the legacy status word when no stage is sent', () => {
    expect(toJobStatusSnapshot({ status: 'completed' }).status).toBe('completed');
    expect(toJobStatusSnapshot({}).status).toBe('queued');
  });

  it('carries percent through as a fraction', () => {
    expect(toJobStatusSnapshot({ stage: 'generating', percent: 45 }).progress).toBe(0.45);
    expect(toJobStatusSnapshot({ progress: 0.3 }).progress).toBe(0.3);
    expect(toJobStatusSnapshot({}).progress).toBeUndefined();
  });

  it('carries the machine stage word verbatim, for the store to keep apart', () => {
    // It is stored on `serverStage`, never on `stage`: "generating" is not
    // what a student should read where "Writing 20 cards" belongs, and
    // jobSheetModel is the one place that turns one into the other.
    expect(toJobStatusSnapshot({ stage: 'generating', percent: 45 }).stage).toBe('generating');
  });

  it('carries the server resultRef through as an artefact to open', () => {
    expect(
      toJobStatusSnapshot({ stage: 'done', resultRef: { type: 'deck', id: 'd1', name: 'From: SDOH' } })
        .artifact
    ).toEqual({ type: 'deck', id: 'd1', name: 'From: SDOH' });
  });

  it('ignores a resultRef this app has no screen for', () => {
    // Better no Open button than one that goes nowhere.
    expect(toJobStatusSnapshot({ stage: 'done', resultRef: { type: 'export', id: 'e1' } }).artifact)
      .toBeUndefined();
    expect(toJobStatusSnapshot({ stage: 'done', resultRef: { type: 'deck' } }).artifact)
      .toBeUndefined();
  });

  it('reads the error from either shape', () => {
    expect(toJobStatusSnapshot({ error: 'flat' }).error).toBe('flat');
    expect(toJobStatusSnapshot({ error: { message: 'structured' } }).error).toBe('structured');
    expect(toJobStatusSnapshot({ errorMessage: 'flattened', error: { message: 'x' } }).error).toBe(
      'flattened'
    );
  });
});


// ─────────────────────────────────────────────────────────────
// F3 — the empty "From: …" decks
// ─────────────────────────────────────────────────────────────

describe('planSave — a job saves once', () => {
  it('lets a job that has never saved go ahead', () => {
    expect(planSave(job())).toEqual({ action: 'save' });
    expect(planSave(undefined)).toEqual({ action: 'save' });
  });

  it('sends a job that already saved back to the SAME artefact', () => {
    // Four generations produced four decks on the device, two of them empty,
    // because every path that could reach a save created one. A job that has
    // written its deck re-opens that deck instead of minting another.
    const saved = job({ savedRef: { type: 'deck', id: 'd1', name: 'From: SDOH' }, savedCount: 10 });
    expect(planSave(saved)).toEqual({
      action: 'reuse',
      ref: { type: 'deck', id: 'd1', name: 'From: SDOH' },
      count: 10,
    });
  });

  it('survives the cold start, because the reference is on the record', () => {
    // planResume/planHydration carry the whole record, savedRef included, so
    // an airplane-mode interruption cannot produce a second deck on resume.
    const saved = job({
      status: 'running',
      serverJobId: 's1',
      savedRef: { type: 'deck', id: 'd1' },
      savedCount: 10,
    });
    const plan = planResume([saved], NOW + 1000);
    expect(planSave(plan.jobs[0])).toMatchObject({ action: 'reuse' });
  });
});

describe('claimSave', () => {
  it('records the reference once and refuses a second, different one', () => {
    const first = claimSave([job()], 'j1', { type: 'deck', id: 'd1' }, 10, NOW);
    expect(first.claimed).toBe(true);
    const second = claimSave(first.jobs, 'j1', { type: 'deck', id: 'd2' }, 10, NOW + 1);
    expect(second.claimed).toBe(false);
    expect(findJob(second.jobs, 'j1')?.savedRef).toEqual({ type: 'deck', id: 'd1' });
  });

  it('does nothing for a job that is not there', () => {
    expect(claimSave([], 'gone', { type: 'deck', id: 'd1' }, 1, NOW).claimed).toBe(false);
  });
});

describe('isPersistedId', () => {
  it('knows an optimistic offline row from a saved one', () => {
    // Nothing rebinds a `temp_` id after a sync, so a deck saved under one is
    // not a deck the student has.
    expect(isPersistedId('deck-1')).toBe(true);
    expect(isPersistedId('temp_deck_1700000000000')).toBe(false);
    expect(isPersistedId('')).toBe(false);
    expect(isPersistedId(undefined)).toBe(false);
  });
});

describe('planDeckSave — the rollback plan', () => {
  it('keeps a deck whose cards actually landed, and counts only those', () => {
    expect(planDeckSave({ requested: 10, saved: 10, deckId: 'd1' })).toEqual({
      action: 'keep',
      resultCount: 10,
    });
    // 8 of 10 landed: the student is told 8, never the 10 that were generated.
    expect(planDeckSave({ requested: 10, saved: 8, deckId: 'd1' })).toEqual({
      action: 'keep',
      resultCount: 8,
    });
  });

  it('rolls back a deck that got no cards, rather than leaving an empty one', () => {
    const plan = planDeckSave({ requested: 10, saved: 0, deckId: 'd1' });
    expect(plan.action).toBe('rollback');
    expect(plan).toMatchObject({ reason: expect.stringContaining('try again') });
  });

  it('rolls back a deck the server never issued an id for', () => {
    // The airplane-mode case: everything "succeeded" locally and the sheet
    // announced "10 flashcards ready", over a deck that did not exist.
    expect(planDeckSave({ requested: 10, saved: 10, deckId: 'temp_deck_1' }).action).toBe(
      'rollback'
    );
  });

  it('says so plainly when there was nothing to save', () => {
    expect(planDeckSave({ requested: 0, saved: 0, deckId: 'd1' })).toEqual({
      action: 'rollback',
      reason: 'Nothing was generated to save.',
    });
  });
});

describe('findJobByAnyId', () => {
  it('finds a job by the server id a push or a deep link names', () => {
    const jobs = [job({ id: 'j1', serverJobId: 'srv-1' })];
    expect(findJobByAnyId(jobs, 'srv-1')?.id).toBe('j1');
    expect(findJobByAnyId(jobs, 'j1')?.id).toBe('j1');
    expect(findJobByAnyId(jobs, 'nope')).toBeUndefined();
  });
});

describe('planServerSettle — settling from the server when the runner is gone', () => {
  const resumed = job({ serverJobId: 's1', status: 'running' });

  it('is done when the server names the artefact', () => {
    expect(
      planServerSettle(resumed, {
        status: 'completed',
        artifact: { type: 'note', id: 'n1' },
      })
    ).toEqual({ status: 'done', artifact: { type: 'note', id: 'n1' } });
  });

  it('is done with the persisted savedRef when the client already saved', () => {
    const saved = job({ serverJobId: 's1', status: 'running', savedRef: { type: 'deck', id: 'd9' }, savedCount: 10 });
    expect(planServerSettle(saved, { status: 'completed' })).toEqual({
      status: 'done',
      artifact: { type: 'deck', id: 'd9' },
    });
  });

  it('is LOST, not done, when a client-saved kind completed with nothing saved', () => {
    const plan = planServerSettle(resumed, {
      status: 'completed',
      result: { flashcards: new Array(10).fill({ front: 'q', back: 'a' }) },
    });
    expect(plan?.status).toBe('lost');
    expect(plan?.artifact).toBeUndefined();
  });

  it('carries the server error on a failure', () => {
    expect(planServerSettle(resumed, { status: 'failed', error: 'Note was empty.' })).toEqual({
      status: 'failed',
      error: 'Note was empty.',
    });
    expect(planServerSettle(resumed, { status: 'failed' })?.error).toBe('The generation failed.');
  });

  it('says nothing while the server is still working', () => {
    expect(planServerSettle(resumed, { status: 'running', stage: 'generating' })).toBeNull();
    expect(planServerSettle(resumed, { status: 'queued' })).toBeNull();
  });
});

describe('isSyncOpOrphanedByDeckDelete', () => {
  it("drops the deck's own queued create/update/delete", () => {
    expect(
      isSyncOpOrphanedByDeckDelete({ entityType: 'deck', entityId: 'temp_deck_1', operation: 'create' }, 'temp_deck_1')
    ).toBe(true);
    expect(
      isSyncOpOrphanedByDeckDelete({ entityType: 'deck', entityId: 'other', operation: 'create' }, 'temp_deck_1')
    ).toBe(false);
  });

  it('drops card creates aimed at that deck, and nothing else', () => {
    const into = { entityType: 'flashcard', entityId: 'temp_card_1', operation: 'create', data: { deckId: 'temp_deck_1' } };
    const elsewhere = { entityType: 'flashcard', entityId: 'temp_card_2', operation: 'create', data: { deckId: 'd2' } };
    const review = { entityType: 'flashcard_review', entityId: 'c1', operation: 'create', data: { deckId: 'temp_deck_1' } };
    expect(isSyncOpOrphanedByDeckDelete(into, 'temp_deck_1')).toBe(true);
    expect(isSyncOpOrphanedByDeckDelete(elsewhere, 'temp_deck_1')).toBe(false);
    expect(isSyncOpOrphanedByDeckDelete(review, 'temp_deck_1')).toBe(false);
    expect(isSyncOpOrphanedByDeckDelete(into, '')).toBe(false);
  });
});

describe('generated material that has not been saved', () => {
  const cards = [{ front: 'q', back: 'a' }];
  const holding = job({
    pendingSave: { kind: 'deck', deckName: 'From: SDOH', cards },
  });

  it('is only "unsaved" while nothing has landed', () => {
    expect(hasUnsavedGeneration(holding)).toBe(true);
    expect(
      hasUnsavedGeneration({ ...holding, savedRef: { type: 'deck', id: 'd1' } })
    ).toBe(false);
    expect(hasUnsavedGeneration(job())).toBe(false);
    expect(hasUnsavedGeneration(undefined)).toBe(false);
  });

  it('retries the SAVE rather than the generation — the credit is already spent', () => {
    expect(planRetry(holding)).toBe('save');
    expect(planRetry(job({ status: 'failed', error: 'The AI call failed.' }))).toBe('generate');
    expect(planRetry({ ...holding, savedRef: { type: 'deck', id: 'd1' } })).toBe('none');
    expect(planRetry(undefined)).toBe('none');
  });

  it('resumes a cold start to a save, not to "we lost track of this one"', () => {
    const plan = planResume([holding], NOW + 1000);
    expect(plan.unsaved).toEqual([holding.id]);
    expect(plan.lost).toEqual([]);
    const resumed = plan.jobs[0];
    expect(resumed.status).toBe('failed');
    expect(resumed.error).toBe(UNSAVED_GENERATION_ERROR);
    // The material itself survives the resume — it is what the button saves.
    expect(resumed.pendingSave).toEqual({ kind: 'deck', deckName: 'From: SDOH', cards });
  });

  it('still loses track of a job that generated nothing and has no server id', () => {
    const plan = planResume([job()], NOW + 1000);
    expect(plan.lost).toEqual(['j1']);
    expect(plan.jobs[0].status).toBe('lost');
  });

  it("does not call a server 'completed' a loss when the material is here", () => {
    expect(planServerSettle(holding, { status: 'completed' })).toEqual({
      status: 'failed',
      error: UNSAVED_GENERATION_ERROR,
    });
  });
});
