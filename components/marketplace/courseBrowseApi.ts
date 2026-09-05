/**
 * Web reads behind "Browse by course" (Gap 3).
 *
 * Rides `academicRequest` (services/academic.ts) rather than minting a second
 * fetch/auth/session-expiry stack, the same way the other Phase 1 services do.
 * Both endpoints sit inside /api/v1/marketplace, so they inherit the
 * private-pilot gate: a 403 here means "not on the pilot", not "no courses".
 * (academicRequest treats 401/403 as a session problem and retries once after a
 * refresh; the panel is only reachable from inside the already-gated
 * marketplace screen, so that retry costs nothing in practice.)
 */
import { academicRequest } from '../../services/academic';
import type { MarketplaceCourseSummary } from '@lantern/shared/marketplace';

export interface CourseBrowseListing {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  category: string;
  listingKind: string | null;
  status: string;
  createdAt: string | null;
  campusId: string | null;
  campusName: string | null;
  sellerId: string | null;
  sellerName: string | null;
  /** First image only. Never rendered until the reader asks for images. */
  imageUrl: string | null;
  questionCount: number | null;
}

export interface CourseBrowsePage {
  course: {
    id: string;
    code: string;
    title: string;
    institutionId: string | null;
    institutionName: string | null;
  };
  listings: CourseBrowseListing[];
  total: number;
}

export async function fetchMarketplaceCourses(options: {
  institutionId?: string | null;
  limit?: number;
} = {}): Promise<{ courses: MarketplaceCourseSummary[]; truncated: boolean }> {
  const params = new URLSearchParams();
  if (options.institutionId) params.append('institutionId', options.institutionId);
  if (options.limit) params.append('limit', String(options.limit));
  const qs = params.toString();
  // academicRequest already unwraps the `{ success, data }` envelope.
  const result = await academicRequest<{
    courses: MarketplaceCourseSummary[];
    truncated: boolean;
  } | null>(`/marketplace/courses${qs ? `?${qs}` : ''}`);
  return {
    courses: result?.courses ?? [],
    truncated: Boolean(result?.truncated),
  };
}

export async function fetchMarketplaceCourseListings(
  courseId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<CourseBrowsePage | null> {
  const params = new URLSearchParams();
  if (options.limit) params.append('limit', String(options.limit));
  if (options.offset) params.append('offset', String(options.offset));
  const qs = params.toString();
  const result = await academicRequest<CourseBrowsePage | null>(
    `/marketplace/courses/${encodeURIComponent(courseId)}/listings${qs ? `?${qs}` : ''}`
  );
  return result ?? null;
}
