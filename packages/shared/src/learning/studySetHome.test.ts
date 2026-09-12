import {
  STUDY_SET_HOME_PRIMARY_TOOL_IDS,
  STUDY_SET_HOME_TOOLS,
  STUDY_SET_RECOMMENDED_CARDS,
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
  // The companion door carried five names on one device pass — "Ask",
  // "Ask Lantern", "AI", "Lantern AI", and the tutor row read as a sixth.
  // One door, one name: **Ask Lantern**. "Lantern AI" is the product, and it
  // belongs to the panel header alone; a door never wears it, and no door is
  // ever labelled the bare "AI".
  it('names the companion door "Ask Lantern" on both the tool row and the card', () => {
    const tool = STUDY_SET_HOME_TOOLS.find((entry) => entry.id === 'ask');
    const card = STUDY_SET_RECOMMENDED_CARDS.find((entry) => entry.id === 'ask');
    expect(tool?.label).toBe('Ask Lantern');
    expect(card?.label).toBe('Ask Lantern');
  });

  it('lets no other door borrow the companion\'s name', () => {
    // The Tutor door is a different feature: a structured lesson, not a chat.
    // It must not read as a second way in to the companion.
    const labels = [
      ...STUDY_SET_HOME_TOOLS.map((tool) => tool.label),
      ...STUDY_SET_RECOMMENDED_CARDS.map((card) => card.label),
    ];
    expect(labels.filter((label) => /lantern/i.test(label))).toEqual(['Ask Lantern', 'Ask Lantern']);
    expect(labels).not.toContain('AI');
    expect(labels).not.toContain('Lantern AI');
    expect(STUDY_SET_RECOMMENDED_CARDS.find((card) => card.id === 'lesson')?.label).toBe('Tutor');
  });
});
