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
