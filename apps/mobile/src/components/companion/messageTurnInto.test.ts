import { messageToNoteDraft } from '@lantern/shared/learning/messageTurnInto';
import {
  messageNotePayload,
  messageTurnIntoStudioRoute,
  roomScopeFromRouteParams,
} from './messageTurnInto';

const NOW = new Date('2026-09-12T10:30:00.000Z');

describe('roomScopeFromRouteParams', () => {
  it('reads the room off the route, ignoring blanks', () => {
    expect(roomScopeFromRouteParams({ studySetId: 'set-1', courseLabel: ' Biology ' })).toEqual({
      studySetId: 'set-1',
      courseId: undefined,
      courseLabel: 'Biology',
    });
    expect(roomScopeFromRouteParams(null)).toEqual({
      studySetId: undefined,
      courseId: undefined,
      courseLabel: undefined,
    });
    expect(roomScopeFromRouteParams({ studySetId: '   ' }).studySetId).toBeUndefined();
  });
});

describe('messageNotePayload', () => {
  it('files the answer in the room the sheet came up over', () => {
    const draft = messageToNoteDraft({ content: 'Ohm law\n\nV = IR' }, 'Physics', NOW);
    expect(messageNotePayload(draft, { studySetId: 'set-1' })).toEqual({
      title: 'Ohm law',
      body: 'Ohm law\n\nV = IR\n\nFrom Lantern AI · 12 September 2026',
      sourceType: 'typed',
      studySetId: 'set-1',
    });
  });

  it('leaves the note unfiled rather than inventing a room', () => {
    const draft = messageToNoteDraft({ content: 'Answer' }, null, NOW);
    const payload = messageNotePayload(draft, {});
    expect('studySetId' in payload).toBe(false);
    expect('courseId' in payload).toBe(false);
  });
});

describe('messageTurnIntoStudioRoute', () => {
  const scope = { studySetId: 'set-1', courseLabel: 'Physics' };

  it('sends the three note studios to the saved note', () => {
    expect(messageTurnIntoStudioRoute('lesson', scope, 'note-9')).toEqual({
      screen: 'LessonStudio',
      params: { courseId: undefined, courseLabel: 'Physics', studySetId: 'set-1', noteId: 'note-9' },
    });
    expect(messageTurnIntoStudioRoute('recap', scope, 'note-9')?.screen).toBe('RecapStudio');
    expect(messageTurnIntoStudioRoute('essay', scope, 'note-9')?.screen).toBe('EssayStudio');
  });

  it('sends play to the room, which is where its cards are', () => {
    const route = messageTurnIntoStudioRoute('play', scope, 'note-9');
    expect(route?.screen).toBe('PlayStudio');
    expect(route?.params.noteId).toBeUndefined();
  });

  it('returns nothing for the two targets that run a job instead', () => {
    expect(messageTurnIntoStudioRoute('cards', scope, 'note-9')).toBeNull();
    expect(messageTurnIntoStudioRoute('test', scope, 'note-9')).toBeNull();
  });

  it('refuses to open a studio with no room behind it', () => {
    expect(messageTurnIntoStudioRoute('lesson', {}, 'note-9')).toBeNull();
  });
});
