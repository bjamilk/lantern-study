/**
 * The shapes a real offline bundle has been found to carry, and what each one
 * has to become before a student can answer it.
 *
 * The device case this file is built around (build 172): a downloaded
 * 15-question test whose every option rendered as a bare letter with no text.
 */
import {
  isPlayableOfflineQuestion,
  normalizeOfflineBundleQuestion,
  normalizeQuestionOptions,
  planBundlePlayability,
} from './offlineQuestionShape';

describe('normalizeQuestionOptions: every writer that has filled `options`', () => {
  it('reads the canonical chat shape and marks the answer from correctAnswerIds', () => {
    const options = normalizeQuestionOptions({
      options: [
        { id: 'o1', text: 'Lagos' },
        { id: 'o2', text: 'Abuja' },
      ],
      correctAnswerIds: ['o2'],
    });

    expect(options).toEqual([
      { id: 'o1', text: 'Lagos', isCorrect: false },
      { id: 'o2', text: 'Abuja', isCorrect: true },
    ]);
  });

  it('reads plain strings — the generator shape — instead of dropping their text', () => {
    // THE DEFECT: `opt.text` on a string is undefined, so every option came
    // out with an empty label and the question was unanswerable.
    const options = normalizeQuestionOptions({
      options: ['Status asthmaticus', 'Silent chest', 'Pulsus paradoxus'],
      correctAnswer: 'Status asthmaticus',
    });

    expect(options.map((o) => o.text)).toEqual([
      'Status asthmaticus',
      'Silent chest',
      'Pulsus paradoxus',
    ]);
    expect(options[0].isCorrect).toBe(true);
    expect(options[1].isCorrect).toBe(false);
  });

  it('reads a `choices` list and an option whose text is called optionText', () => {
    const options = normalizeQuestionOptions({
      choices: [
        { id: 'a', optionText: 'Bronchodilator' },
        { id: 'b', label: 'Antibiotic' },
        { id: 'c', value: 'Diuretic' },
      ],
      correctOptionIds: ['a'],
    });

    expect(options.map((o) => o.text)).toEqual(['Bronchodilator', 'Antibiotic', 'Diuretic']);
    expect(options[0].isCorrect).toBe(true);
  });

  it('treats a letter answer as a position, so the right option is the right one', () => {
    const options = normalizeQuestionOptions({
      options: ['Alveoli', 'Bronchi', 'Capillaries'],
      correctAnswer: 'B',
    });

    expect(options.find((o) => o.isCorrect)?.text).toBe('Bronchi');
  });

  it('but a letter that is genuinely one of the options wins over its position', () => {
    // Blood groups: "B" is an answer here, not the label of position 1
    // (which reads "AB"). Note ['A', 'B', 'C'] would NOT be a fixture for
    // this — letters in their own positions are a label set, see below.
    const options = normalizeQuestionOptions({
      options: ['O', 'AB', 'B', 'A'],
      correctAnswer: 'B',
    });

    expect(options.map((o) => o.text)).toEqual(['O', 'AB', 'B', 'A']);
    expect(options.find((o) => o.isCorrect)?.text).toBe('B');
  });

  it('takes an index answer', () => {
    const options = normalizeQuestionOptions({
      options: ['One', 'Two', 'Three'],
      correctAnswer: 2,
    });

    expect(options.find((o) => o.isCorrect)?.text).toBe('Three');
  });

  it('drops an option whose text cannot be recovered rather than showing a blank row', () => {
    // This is what reached the student: ids with no text, drawn as A/B/C/D.
    const options = normalizeQuestionOptions({
      options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
    });

    expect(options).toEqual([]);
  });

  it('treats option TEXTS that are only their own letters as labels, not answers', () => {
    // The player prints option text with no letter beside it, so this is the
    // literal shape behind the four rows reading A / B / C / D on device.
    expect(
      normalizeQuestionOptions({
        options: [
          { id: 'A', text: 'A' },
          { id: 'B', text: 'B' },
          { id: 'C', text: 'C' },
          { id: 'D', text: 'D' },
        ],
        correctAnswer: 'B',
      })
    ).toEqual([]);
    expect(normalizeQuestionOptions({ options: ['a', 'b', 'c'] })).toEqual([]);

    // A single letter that IS the answer is kept: blood groups are not labels.
    const bloodGroups = normalizeQuestionOptions({ options: ['A', 'B', 'AB', 'O'], correctAnswer: 'O' });
    expect(bloodGroups.map((o) => o.text)).toEqual(['A', 'B', 'AB', 'O']);
    expect(bloodGroups.find((o) => o.isCorrect)?.text).toBe('O');

    // And a bundle already stored with letter texts is refused at start.
    expect(
      isPlayableOfflineQuestion({
        type: 'mcq-single',
        options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }],
      })
    ).toBe(false);
  });
});

describe('normalizeOfflineBundleQuestion', () => {
  it('normalises a web-shaped bundle entry', () => {
    const question = normalizeOfflineBundleQuestion(
      {
        id: 'q1',
        type: 'QUESTION',
        questionStem: 'What is the capital of Nigeria?',
        questionType: 'multiple_choice_single',
        options: [
          { id: 'o1', text: 'Lagos' },
          { id: 'o2', text: 'Abuja' },
        ],
        correctAnswerIds: ['o2'],
        tags: ['Geography'],
      },
      0
    )!;

    expect(question.stem).toBe('What is the capital of Nigeria?');
    expect(question.options.map((o) => o.text)).toEqual(['Lagos', 'Abuja']);
    expect(question.correctAnswer).toBe('Abuja');
    expect(question.tags).toEqual(['Geography']);
  });

  it('resolves a letter correctAnswer to the option TEXT the runner compares', () => {
    const question = normalizeOfflineBundleQuestion(
      {
        id: 'q2',
        questionStem: 'Where does gas exchange happen?',
        questionType: 'MULTIPLE_CHOICE_SINGLE',
        options: ['Alveoli', 'Bronchi'],
        correctAnswer: 'A',
      },
      0
    )!;

    // 'A' would have matched nothing on grading; the text does.
    expect(question.correctAnswer).toBe('Alveoli');
  });

  it('keeps a mobile-shaped entry unchanged (the mapper is idempotent)', () => {
    const mobileShaped = {
      id: 'q3',
      stem: 'Nigeria has how many states?',
      type: 'mcq-single',
      options: [
        { id: 'a', text: '36', isCorrect: true },
        { id: 'b', text: '30', isCorrect: false },
      ],
      tags: [],
    };

    const once = normalizeOfflineBundleQuestion(mobileShaped, 0)!;
    const twice = normalizeOfflineBundleQuestion(once, 0)!;

    expect(twice.options).toEqual(once.options);
    expect(twice.stem).toBe('Nigeria has how many states?');
    expect(twice.correctAnswer).toBe('36');
  });

  it('keeps fill-in-blank answers so grading still works', () => {
    const question = normalizeOfflineBundleQuestion(
      {
        id: 'q4',
        questionStem: 'The sex of Michael is ___?',
        questionType: 'fill_in_the_blank',
        acceptableAnswers: ['Male', 'male'],
      },
      0
    )!;

    expect(question.correctAnswer).toBe('Male');
    expect(question.acceptableAnswers).toEqual(['Male', 'male']);
  });

  it('keeps the matching structures the pair rebuilder needs', () => {
    const question = normalizeOfflineBundleQuestion(
      {
        id: 'q5',
        questionStem: 'Match the capital to the country',
        questionType: 'matching',
        matchingPromptItems: [{ id: 'p1', text: 'Nigeria' }],
        matchingAnswerItems: [{ id: 'a1', text: 'Abuja' }],
        correctMatches: [{ promptItemId: 'p1', answerItemId: 'a1' }],
      },
      0
    )!;

    expect(question.correctMatches).toEqual([{ promptItemId: 'p1', answerItemId: 'a1' }]);
    expect(question.matchingAnswerItems).toEqual([{ id: 'a1', text: 'Abuja' }]);
  });

  it('drops an entry with no stem rather than rendering a blank question', () => {
    expect(normalizeOfflineBundleQuestion({ id: 'x', type: 'QUESTION' }, 0)).toBeNull();
  });
});

describe('planBundlePlayability: what a download can honestly run', () => {
  const answerable = {
    type: 'multiple_choice_single',
    options: [
      { id: 'a', text: 'Alveoli' },
      { id: 'b', text: 'Bronchi' },
    ],
  };
  const optionless = { type: 'multiple_choice_single', options: [] };

  it('says nothing when every question is answerable', () => {
    const plan = planBundlePlayability([answerable, answerable]);
    expect(plan.notice).toBeNull();
    expect(plan.canStart).toBe(true);
    expect(plan.playable).toHaveLength(2);
  });

  it('leaves out the unanswerable ones and counts them in plain words', () => {
    const plan = planBundlePlayability([answerable, optionless, optionless]);

    expect(plan.playable).toHaveLength(1);
    expect(plan.droppedCount).toBe(2);
    expect(plan.canStart).toBe(true);
    expect(plan.notice).toBe(
      '2 questions in this download are missing their answer options and have been left out. You can answer the other 1.'
    );
  });

  it('refuses to open a session where nothing can be answered', () => {
    const plan = planBundlePlayability([optionless, optionless]);

    expect(plan.canStart).toBe(false);
    expect(plan.playable).toEqual([]);
    expect(plan.notice).toContain('none of its questions can be answered');
  });

  it('never names a key, a field or a file in what the student reads', () => {
    const plan = planBundlePlayability([answerable, optionless]);
    expect(plan.notice).not.toMatch(/option[sS]?\.|questionType|json|undefined|null/);
  });

  it('judges each type by what it is graded on', () => {
    expect(isPlayableOfflineQuestion({ type: 'fill_in_blank', acceptableAnswers: ['Male'] })).toBe(
      true
    );
    expect(isPlayableOfflineQuestion({ type: 'fill_in_blank' })).toBe(false);
    expect(
      isPlayableOfflineQuestion({ type: 'matching', correctMatches: [{ a: 1 } as never] })
    ).toBe(true);
    expect(isPlayableOfflineQuestion({ type: 'matching' })).toBe(false);
    // One readable option is not a choice.
    expect(
      isPlayableOfflineQuestion({ type: 'mcq-single', options: [{ text: 'Only one' }] })
    ).toBe(false);
  });
});
