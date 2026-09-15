/**
 * Barrel for the tests lane, in the order a student moves through it: the tests
 * home (TestScreen), the builder, the taking screen, the results screen, and
 * the analysis charts.
 *
 * Default exports only. The pure helpers next to these files (testAuthoring,
 * testConfigRules, testSessionExit, confidenceReveal) are deliberately not
 * re-exported here — they are imported directly so they stay React-free.
 */
export { default as TestScreen } from './TestScreen';
export { default as TestBuilderScreen } from './TestBuilderScreen';
export { default as TestTakingScreen } from './TestTakingScreen';
export { default as TestResultsScreen } from './TestResultsScreen';
export { default as TestAnalysisScreen } from './TestAnalysisScreen';
