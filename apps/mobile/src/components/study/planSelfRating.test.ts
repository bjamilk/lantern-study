/**
 * The plan-entry self-rating: which topics it asks about, when it is offered,
 * and that the phone asks the web's question in the web's words.
 *
 * The wiring half is a source scan rather than a render. The panel's write path
 * is the single fact that makes this feature worth shipping — a rating has to
 * travel `onToggleTopic` → `useStudySetStore.setTopicStatus` → `PATCH
 * /users/me/study-sets/:id/topics/:topicId`, the same endpoint the web card
 * writes through, or the phone and the web disagree about the same plan. A
 * renderer test would assert a tap; this asserts the destination.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildStudyPlanModel,
  planSelfRatingRows,
  shouldOfferSelfRating,
} from './studyPlanPresentation';
import type { StudySetTopic, StudySetTopicStatus, StudySetUnit } from '@lantern/shared/learning';

function topic(
  id: string,
  unitId: string,
  position: number,
  status: StudySetTopicStatus
): StudySetTopic {
  return { id, studySetId: 'set-a', unitId, title: `Topic ${id}`, position, status, sourceNoteIds: [] };
}

function unit(id: string, title: string, position: number): StudySetUnit {
  return { id, studySetId: 'set-a', title, position };
}

function model(topics: StudySetTopic[]) {
  return buildStudyPlanModel({
    units: [unit('u1', 'Foundations', 10), unit('u2', 'Methods', 20)],
    topics,
    materials: [],
  });
}

const panel = readFileSync(join(__dirname, 'StudyPlanPanel.tsx'), 'utf8');
const sheet = readFileSync(join(__dirname, 'PlanSelfRatingSheet.tsx'), 'utf8');

describe('planSelfRatingRows', () => {
  it('asks only about topics the plan has no answer for', () => {
    const rows = planSelfRatingRows(
      model([
        topic('1', 'u1', 10, 'unseen'),
        topic('2', 'u1', 20, 'covered'),
        topic('3', 'u2', 10, 'mastered'),
        topic('4', 'u2', 20, 'unseen'),
      ])
    );
    expect(rows.map((row) => row.id)).toEqual(['1', '4']);
  });

  it('numbers the walk, not the plan', () => {
    // `2 of 2`, never `4 of 4`: a student who already ticked half a plan is not
    // told they have four questions left when they have two.
    const rows = planSelfRatingRows(
      model([
        topic('1', 'u1', 10, 'covered'),
        topic('2', 'u1', 20, 'covered'),
        topic('3', 'u2', 10, 'unseen'),
        topic('4', 'u2', 20, 'unseen'),
      ])
    );
    expect(rows.map((row) => row.positionLabel)).toEqual(['1 of 2', '2 of 2']);
  });

  it('names the unit each topic sits under, as the spine draws it', () => {
    const rows = planSelfRatingRows(
      model([topic('1', 'u1', 10, 'unseen'), topic('2', 'u2', 10, 'unseen')])
    );
    expect(rows.map((row) => row.unitLabel)).toEqual(['01 Foundations', '02 Methods']);
  });

  it('walks in plan order, unit by unit', () => {
    const rows = planSelfRatingRows(
      model([
        topic('late', 'u2', 10, 'unseen'),
        topic('early', 'u1', 10, 'unseen'),
      ])
    );
    expect(rows.map((row) => row.id)).toEqual(['early', 'late']);
  });
});

describe('shouldOfferSelfRating', () => {
  it('offers the card while un-rated topics remain', () => {
    expect(shouldOfferSelfRating(model([topic('1', 'u1', 10, 'unseen')]), true)).toBe(true);
  });

  it('stops offering once every topic carries an answer', () => {
    // The web card's own comment says it should be "hidden once it has been
    // worked through"; its shipped condition re-offers the whole walk for ever.
    expect(
      shouldOfferSelfRating(
        model([topic('1', 'u1', 10, 'covered'), topic('2', 'u2', 10, 'mastered')]),
        true
      )
    ).toBe(false);
  });

  it('is silent on a plan that has no server row to write to', () => {
    // `onToggleTopic` is a no-op until the plan is saved, so the offer would
    // collect three minutes of answers and drop them.
    expect(shouldOfferSelfRating(model([topic('1', 'u1', 10, 'unseen')]), false)).toBe(false);
  });

  it('is silent on an empty plan', () => {
    expect(shouldOfferSelfRating(model([]), true)).toBe(false);
  });
});

describe('the card and the sheet say what the web says', () => {
  it('carries the web card\'s headline, promise and button', () => {
    expect(panel).toContain('See what you already know');
    expect(panel).toContain('Takes about 3 minutes · marks topics covered so the plan skips them');
    expect(panel).toContain('Continue');
  });

  it('asks the web\'s question with the web\'s three answers', () => {
    expect(sheet).toContain('Do you already know this well enough to skip it?');
    expect(sheet).toContain('I know this');
    expect(sheet).toContain('Not yet');
    expect(sheet).toContain('Stop the check');
  });

  it('says a rating is an estimate rather than mastery', () => {
    expect(sheet).toContain('This is your own estimate, not a test.');
    // The panel's own sentence for the covered/mastered split, not a second
    // phrasing of it.
    expect(sheet).toContain(
      'Reading a topic covers it. Proving it in a quiz'
    );
  });

  it('never lets a self-rating claim mastery', () => {
    expect(sheet).toContain("onRate(row.id, 'covered')");
    expect(sheet).not.toContain("'mastered'");
  });
});

describe('a rating reaches the same endpoint the web writes to', () => {
  it('is handed the panel\'s own topic-status prop', () => {
    expect(panel).toContain('onRate={onToggleTopic}');
  });

  it('lands on PATCH .../topics/:topicId through the study set store', () => {
    const screen = readFileSync(
      join(__dirname, '..', '..', 'screens', 'study', 'CourseRoomScreen.tsx'),
      'utf8'
    );
    expect(screen).toContain('setTopicStatus(studySetId, topicId, next)');
    const store = readFileSync(join(__dirname, '..', '..', 'stores', 'studySetStore.ts'), 'utf8');
    expect(store).toContain('updateStudySetTopicStatus(setId, topicId, status)');
  });
});
