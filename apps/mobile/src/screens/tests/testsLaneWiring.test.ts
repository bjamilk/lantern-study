import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The wiring the device run of build 162 found missing — asserted against the
 * screens' SOURCE, because mobile jest runs on the node environment and none
 * of these files can be transformed here (they import react-native, the
 * theme, and the store).
 *
 * A source scan cannot prove a control renders. It can prove the two things
 * that were actually wrong: that the control EXISTS in the file at all, and
 * that it is not sitting behind the condition that hid it. Both findings
 * below were of exactly that shape.
 */

const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

describe('TestScreen: the New test door (T1)', () => {
  const source = read('TestScreen.tsx');

  it('renders the control in the header, not only inside the empty state', () => {
    const header = source.slice(
      source.indexOf('<View style={styles.headerTopRow}>'),
      source.indexOf('<Text style={[styles.headerSubtitle')
    );
    expect(header).toContain('testID="tests-new-test"');
    expect(header).toContain('onPress={handleNewTest}');
  });

  it('the header control is unconditional, so it survives both tabs', () => {
    // The defect: the ONLY door was the empty state's action, itself behind
    // `activeTab === 'tests'`. A header control wrapped in any activeTab or
    // tests.length test would reintroduce it.
    const header = source.slice(
      source.indexOf('<View style={styles.headerTopRow}>'),
      source.indexOf('<Text style={[styles.headerSubtitle')
    );
    const doorBlock = header.slice(
      header.lastIndexOf('<TouchableOpacity', header.indexOf('testID="tests-new-test"'))
    );
    expect(doorBlock).not.toMatch(/activeTab\s*===/);
    expect(doorBlock).not.toMatch(/tests\.length/);
  });

  it('both doors lead to TestBuilder and nowhere else', () => {
    expect(source).toContain("navigation.navigate('TestBuilder')");
    // The empty state keeps its action, pointed at the same handler.
    const emptyAction = source.slice(source.indexOf('styles.emptyAction'));
    expect(source.slice(0, source.indexOf('styles.emptyAction'))).toContain('handleNewTest');
    expect(emptyAction.length).toBeGreaterThan(0);
  });
});

describe('TestTakingScreen: practice ends in a review (T2)', () => {
  const source = read('TestTakingScreen.tsx');
  const studyBranch = source.slice(
    source.indexOf("if (liveSession.mode === 'study') {"),
    source.indexOf('if (timeUp) {')
  );

  it('ending a study session submits it instead of discarding it', () => {
    expect(studyBranch).toContain('finalizeSubmit()');
  });

  it('does not exit without recording the attempt', () => {
    expect(studyBranch).not.toContain('exitStudyMode()');
    expect(studyBranch).not.toContain('dismissSession()');
  });

  it('and the submit path lands on the results screen', () => {
    expect(source).toContain("navigation.replace('TestResults'");
  });
});

describe('TestResultsScreen: blanks are not failures (T5)', () => {
  const source = read('TestResultsScreen.tsx');

  it('the practice action counts answered-and-wrong only', () => {
    const memo = source.slice(
      source.indexOf('const failedQuestions = useMemo'),
      source.indexOf('}, [attempt]);', source.indexOf('const failedQuestions = useMemo'))
    );
    expect(memo).toContain('isAnswerProvided(a.userAnswer)');
  });

  it('and is hidden when there is nothing wrong to practise', () => {
    expect(source).toContain('{failedQuestions.length > 0 ?');
  });

  it('never calls a blank a failure', () => {
    // The rendered label, not the comments that quote the old one.
    expect(source).not.toContain('Practice Failed ({');
    expect(source).toContain('Practice wrong answers ({failedQuestions.length})');
  });
});

describe('TestBuilderScreen: a picked row is not a purchase (build 168)', () => {
  const source = read('TestBuilderScreen.tsx');

  it('a picker row selects, and never calls a generate handler', () => {
    const rows = source.slice(
      source.indexOf('data={pickerRows}'),
      source.indexOf('</Modal>')
    );
    expect(rows).toContain('handlePickRow(');
    // The defect: the row's own onPress ran the generation, so one tap on a
    // note's name spent an AI use with nothing on screen naming a price.
    expect(rows).not.toContain('handleDeckPicked(');
    expect(rows).not.toContain('handleNotePicked(');
  });

  it('the only spending control carries the price on its face', () => {
    const button = source.slice(source.indexOf('testID="test-builder-generate"'));
    expect(source).toContain('confirmCard.buttonLabel');
    expect(source).toContain('formatCreditCost(AI_CREDIT_COSTS.generate_questions)');
    expect(button.length).toBeGreaterThan(0);
    expect(source).toContain('onPress={handleGenerate}');
  });

  it('asks for a ceiling and tells the job sheet it is one', () => {
    expect(source).toContain('requestedCount: MAX_GENERATED_QUESTIONS');
    expect(source).toContain('requestedCountIsMax: true');
    // No hard-coded ten anywhere near the copy: the ceiling has one home.
    expect(source).not.toContain('GENERATED_QUESTION_COUNT = 10');
  });
});

/**
 * Build 172's device findings. Same rule as above: a source scan cannot prove
 * a control renders, but it can prove the shipped code calls the planner the
 * unit tests exercise — which is exactly what was missing when a mirrored
 * copy of the offline mapper stayed green while the real one was broken.
 */
describe('the offline bundle has ONE mapper (build 172)', () => {
  const store = read('../../stores/offlineStore.ts');

  it('the store maps through the shared normaliser instead of its own copy', () => {
    expect(store).toContain("from '../utils/offlineQuestionShape'");
    expect(store).toContain('normalizeOfflineBundleQuestion(message, index)');
    // The private option loop that dropped every string option's text.
    expect(store).not.toContain('opt.optionText');
  });

  it('both bundle paths — cloud hydration and group download — use it', () => {
    expect(store).toContain('.map((q, index) => mapMessageToOfflineQuestion(q, index))');
    expect(store).toContain('.map(mapMessageToOfflineQuestion)');
  });

  it('bundles already on the handset are re-normalised when they are read', () => {
    const load = store.slice(
      store.indexOf('loadOfflineData: async'),
      store.indexOf('downloadTest: async')
    );
    expect(load).toContain('JSON.parse(testsData)');
    expect(load).toContain('mapMessageToOfflineQuestion(q, index)');
  });

  it('a bundle with nothing answerable never opens a session', () => {
    const screen = read('../settings/OfflineScreen.tsx');
    expect(screen).toContain('planBundlePlayability(test.questions)');
    expect(screen).toContain('if (!playability.canStart)');
    expect(screen).toContain('offlineQuestionsToTestQuestions(playability.playable)');
  });
});

describe('the start sheet and the player tell the truth (build 172)', () => {
  it('the Test Mode card reads its timer from the same rule as the strip', () => {
    const source = read('TestScreen.tsx');
    expect(source).toContain('describeTestModeCard(defaultMinutesFor(selectedTest))');
    expect(source).not.toContain('Timed • Scored');
  });

  it('History formats a duration honestly instead of padding it to 0:00', () => {
    const source = read('TestScreen.tsx');
    expect(source).toContain('formatSessionDuration(item.timeSpent');
    expect(source).not.toContain("secs.toString().padStart(2, '0')");
  });

  it('the exit dialog is planned, and the two false sentences are gone', () => {
    const source = read('TestTakingScreen.tsx');
    expect(source).toContain('planSessionExitCopy({');
    expect(source).not.toContain('Your progress will be lost');
    expect(source).not.toContain('You can come back anytime');
  });

  it('the player states its own offline status, and the shell chip stands down', () => {
    const source = read('TestTakingScreen.tsx');
    expect(source).toContain('offlineNotice');
    const shell = read('../../navigation/RootNavigator.tsx');
    expect(shell).toContain("focused !== 'TestTaking' ?");
  });
});
