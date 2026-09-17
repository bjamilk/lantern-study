/**
 * data/sitemap.ts — the public URL inventories the search engines crawl.
 *
 * ## Purpose
 *
 * Extracted verbatim from `routes/sitemap.ts` (monolith lane R2, PR 2b). Four
 * chains built inline in the handlers. The route keeps everything that is a
 * decision: the cache key and TTL, the XML it renders, and the 500 stub it
 * answers with when a read fails.
 *
 * ## What it touches
 *
 * Tables: `marketplace_campuses`, `marketplace_listings`, `job_postings`,
 * `job_companies`. Reads only — a sitemap never writes. No storage, no RPCs.
 *
 * ## The gotcha: these filters are a PUBLICATION rule
 *
 * Nothing here is owner-scoped, because a sitemap is public by definition. The
 * predicates do the opposite job — they decide what may be PUBLISHED — and the
 * API holds the service-role client, which BYPASSES RLS, so they are the only
 * thing between a draft listing, a withdrawn job posting or an unverified
 * company and Google's index. Do not relax one to "get more coverage":
 *
 *   - campuses: `active` AND not `kind = 'other'` (the bucket for unrecognised
 *     institutions, which have no page worth indexing);
 *   - listings and postings: `status = 'active'`, and in the default country;
 *   - companies: `verification_status = 'verified'`.
 *
 * The caps are load-bearing too. A sitemap has a size ceiling, and a missing
 * `limit` turns one page into a full table read on every crawl.
 */
import type { DataClient } from "./client";

/** Active, indexable campuses, alphabetically. Capped at 5000. */
export async function listCampusSlugsForSitemap(
  supabase: DataClient,
): Promise<{ data: Array<{ slug: string }> | null; error: any }> {
  return await supabase
    .from("marketplace_campuses")
    .select("slug")
    .eq("active", true)
    .neq("kind", "other")
    .order("name", { ascending: true })
    .limit(5000);
}

/** Active listings in one country, most recently updated first. Capped at 5000. */
export async function listListingsForSitemap(
  supabase: DataClient,
  countryCode: string,
): Promise<{ data: Array<{ id: string; updated_at: string | null }> | null; error: any }> {
  return await supabase
    .from("marketplace_listings")
    .select("id, updated_at")
    .eq("status", "active")
    .eq("country_code", countryCode)
    .order("updated_at", { ascending: false })
    .limit(5000);
}

/** Active job postings in one country, most recently updated first. Capped at 5000. */
export async function listJobPostingsForSitemap(
  supabase: DataClient,
  countryCode: string,
): Promise<{ data: Array<{ id: string; updated_at: string | null }> | null; error: any }> {
  return await supabase
    .from("job_postings")
    .select("id, updated_at")
    .eq("status", "active")
    .eq("country_code", countryCode)
    .order("updated_at", { ascending: false })
    .limit(5000);
}

/** VERIFIED companies only — see the gotcha. Capped at 2000. */
export async function listJobCompaniesForSitemap(
  supabase: DataClient,
): Promise<{ data: Array<{ id: string; updated_at: string | null }> | null; error: any }> {
  return await supabase
    .from("job_companies")
    .select("id, updated_at")
    .eq("verification_status", "verified")
    .order("updated_at", { ascending: false })
    .limit(2000);
}
