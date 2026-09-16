/**
 * data/adminAnalytics.ts — the platform dashboard aggregate.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1, step 3);
 * the smallest of the four zero-cross-talk leaf sections. One function plus the
 * payload shape the admin console renders.
 *
 * ## What it touches
 *
 * No tables directly: two RPCs, `admin_analytics` and
 * `marketplace_zone_analytics`. The aggregation happens in Postgres, not here.
 *
 * ## The gotcha
 *
 * There is NO privilege check in this module. Callers must gate on
 * `isPlatformAdmin` first — the service role will happily run the RPC for
 * anyone, and RLS does not apply to it.
 *
 * The second gotcha is deliberate degradation: a failure of the newer
 * `marketplace_zone_analytics` RPC is logged and the base analytics are
 * returned WITHOUT the zone breakdown, so a database that has not had that
 * migration applied still renders a dashboard instead of a 500.
 */
import { logger } from "../../utils/logger";

import type { DataClient } from "./client";

export async function getAdminAnalytics(
  supabase: DataClient,
  days: number,
): Promise<AdminAnalyticsPayload> {
  const [{ data, error }, { data: zoneData, error: zoneError }] =
    await Promise.all([
      supabase.rpc("admin_analytics", { p_days: days }),
      supabase.rpc("marketplace_zone_analytics", { p_days: days }),
    ]);
  if (error) throw error;

  const analytics = data as AdminAnalyticsPayload;
  if (zoneError || !zoneData || typeof zoneData !== "object") {
    if (zoneError) {
      logger.warn("marketplace_zone_analytics RPC failed", {
        error: zoneError.message,
      });
    }
    return analytics;
  }

  const zones = zoneData as {
    gmvByZone?: Array<{ zone: string; gmv: number; orders: number }>;
    listingsByZone?: Array<{
      zone: string;
      total: number;
      active: number;
      sold: number;
    }>;
    searchesByZone?: Array<{ zone: string; count: number }>;
    searchesByCampus?: Array<{ campus: string; count: number }>;
  };
  return {
    ...analytics,
    marketplaceKpis: analytics.marketplaceKpis
      ? {
          ...analytics.marketplaceKpis,
          gmvByZone: zones.gmvByZone || [],
          listingsByZone: zones.listingsByZone || [],
        }
      : analytics.marketplaceKpis,
    searchAnalytics: analytics.searchAnalytics
      ? {
          ...analytics.searchAnalytics,
          searchesByCampus:
            zones.searchesByCampus ||
            analytics.searchAnalytics.searchesByCampus,
          searchesByZone: zones.searchesByZone || [],
        }
      : analytics.searchAnalytics,
  };
}

export interface AdminAnalyticsPayload {
  periodDays: number;
  kpis: {
    totalUsers: number;
    dau: number;
    wau: number;
    mau: number;
    mobileAppUsers: number;
    webOnlyUsers: number;
    activeGroups: number;
  };
  marketplaceKpis?: {
    gmv: number;
    ordersCount: number;
    aov: number;
    disputedRate: number;
    disputedCount: number;
    gmvByCategory: Array<{ category: string; gmv: number; orders: number }>;
    gmvByCampus: Array<{ campus: string; gmv: number; orders: number }>;
    gmvByZone?: Array<{ zone: string; gmv: number; orders: number }>;
    listingsByZone?: Array<{
      zone: string;
      total: number;
      active: number;
      sold: number;
    }>;
  };
  retentionCohorts?: {
    signups: number;
    d1: number;
    d7: number;
    d30: number;
    d1Count: number;
    d7Count: number;
    d30Count: number;
  };
  searchAnalytics?: {
    topQueries: Array<{ query: string; count: number }>;
    zeroResultQueries: Array<{ query: string; count: number }>;
    searchesByCampus: Array<{ campus: string; count: number }>;
    searchesByZone?: Array<{ zone: string; count: number }>;
    totalSearches: number;
  };
  acquisitionFunnel?: {
    guestListingViews: number;
    signupStarted: number;
    signupsCompleted: number;
    onboardingCompleted: number;
  };
  studyFunnel?: {
    testsStarted: number;
    testsCompleted: number;
    testsCompletedWeb: number;
    testsCompletedMobile: number;
    flashcardSessionsStarted: number;
    flashcardSessionsCompleted: number;
    notesCreated: number;
    aiToolUses: number;
    aiToolsByType: Record<string, number>;
  };
  platformFromEvents?: {
    webDau: number;
    mobileDau: number;
    webActivePeriod: number;
    mobileActivePeriod: number;
  };
  streakDistribution: Record<string, number>;
  featureTotals: {
    tests: number;
    flashcards: number;
    newFlashcards: number;
    questions: number;
    games: number;
    dailyQuizzes: number;
    studyActions: number;
  };
  aiByFeature: Record<string, number>;
  platformSplit: {
    mobileAppUsers: number;
    webOnlyUsers: number;
  };
  series: Array<{
    date: string;
    signups: number;
    activeUsers: number;
    tests: number;
    flashcards: number;
    newFlashcards: number;
    questions: number;
    games: number;
    dailyQuizzes: number;
    groupMessages: number;
    dmMessages: number;
    aiEvents: number;
    newListings: number;
    orders: number;
    gmv?: number;
  }>;
}
