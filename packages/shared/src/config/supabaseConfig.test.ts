import {
  formatSupabaseClientAuthError,
  getCloudSupabaseProjectRef,
  isMismatchedCloudSupabaseAnonKey,
  reconcileSupabaseAnonKey,
  SUPABASE_INVALID_API_KEY_USER_MESSAGE,
} from './index';

const CLOUD_URL = 'https://tiizkjhbrnaibaagmurl.supabase.co';
const CLOUD_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXpramhicm5haWJhYWdtdXJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjMyMjMsImV4cCI6MjA5NjQzOTIyM30.dzI3L5Blbao5DItW3xgMIUzAi9LBijZncFaNBLTMvoE';
const DEMO_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

describe('supabase config reconciliation', () => {
  it('extracts project ref from cloud URL', () => {
    expect(getCloudSupabaseProjectRef(CLOUD_URL)).toBe('tiizkjhbrnaibaagmurl');
    expect(getCloudSupabaseProjectRef('http://localhost:55421')).toBeNull();
  });

  it('detects demo anon against cloud URL', () => {
    expect(isMismatchedCloudSupabaseAnonKey(CLOUD_URL, DEMO_ANON)).toBe(true);
    expect(isMismatchedCloudSupabaseAnonKey(CLOUD_URL, CLOUD_ANON)).toBe(false);
    expect(isMismatchedCloudSupabaseAnonKey('http://localhost:55421', DEMO_ANON)).toBe(false);
  });

  it('replaces demo anon with cloud fallback for Lantern project', () => {
    expect(reconcileSupabaseAnonKey(CLOUD_URL, DEMO_ANON)).toBe(CLOUD_ANON);
    expect(reconcileSupabaseAnonKey(CLOUD_URL, CLOUD_ANON)).toBe(CLOUD_ANON);
  });

  it('leaves local URL + demo anon unchanged', () => {
    expect(reconcileSupabaseAnonKey('http://localhost:55421', DEMO_ANON)).toBe(DEMO_ANON);
  });

  it('maps Invalid API key to a clearer user message', () => {
    expect(formatSupabaseClientAuthError('Invalid API key')).toBe(
      SUPABASE_INVALID_API_KEY_USER_MESSAGE
    );
    expect(formatSupabaseClientAuthError('Invalid login credentials')).toBe(
      'Invalid login credentials'
    );
  });
});
