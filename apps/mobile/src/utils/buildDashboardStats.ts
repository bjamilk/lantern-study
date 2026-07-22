/** Re-exports the shared dashboard-stats builder (single source of truth for web + mobile). */
export {
  buildDashboardStats,
  normalizeTestResults,
  normalizeUserQuestionStats,
  type RawTestResult,
  type UserQuestionStatEntry,
} from '@lantern/shared/utils/buildDashboardStats';
