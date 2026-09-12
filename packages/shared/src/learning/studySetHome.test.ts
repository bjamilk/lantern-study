import {
  STUDY_SET_HOME_PRIMARY_TOOL_IDS,
  STUDY_SET_HOME_TOOLS,
  type StudySetHomeToolId,
} from './studySetHome';

describe('studySetHome', () => {
  it('lists every primary tool as a real tool', () => {
    const known = new Set<StudySetHomeToolId>(STUDY_SET_HOME_TOOLS.map((tool) => tool.id));
    for (const id of STUDY_SET_HOME_PRIMARY_TOOL_IDS) {
      expect(known.has(id)).toBe(true);
    }
    expect(new Set(STUDY_SET_HOME_PRIMARY_TOOL_IDS).size).toBe(
      STUDY_SET_HOME_PRIMARY_TOOL_IDS.length
    );
  });

  it('keeps the study plan reachable from the set-scoped tool grid', () => {
    // The mobile course room filters its grid by this list, so a missing
    // 'plan' hides the plan tile the moment a set has content.
    expect(STUDY_SET_HOME_PRIMARY_TOOL_IDS).toContain('plan');
    expect(STUDY_SET_HOME_TOOLS.find((tool) => tool.id === 'plan')?.activity).toBe('plan');
  });

  it('keeps the essay studio reachable from the set-scoped tool grid', () => {
    // Mobile has EssayStudioScreen and the room routes the id, but the grid is
    // filtered by this list, so a missing 'essay' left a set room with no way in.
    expect(STUDY_SET_HOME_PRIMARY_TOOL_IDS).toContain('essay');
    expect(STUDY_SET_HOME_TOOLS.find((tool) => tool.id === 'essay')?.activity).toBe('essay');
  });
});
