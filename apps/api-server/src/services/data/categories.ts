/**
 * data/categories.ts — custom categories and user preferences.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1, step 3).
 * Two small, unrelated-to-everything-else tables that the measurement found
 * had zero cross-talk with the rest of the monolith.
 *
 * ## What it touches
 *
 * Tables: `custom_categories`, `user_preferences`. No storage buckets, no
 * RPCs.
 *
 * ## The gotcha
 *
 * `custom_categories` is a shared, platform-wide vocabulary ranked by
 * `usage_count` — creating one is a get-or-create BY NAME, not a per-user row,
 * so it is the one write in the data layer a caller does not own outright.
 * `createCustomCategory` therefore has to handle the race it loses: two
 * concurrent creates both miss the `select`, one insert wins and the other
 * comes back `23505`, which is re-read rather than thrown.
 *
 * `user_preferences` is strictly owner-scoped; reads normalize through
 * `normalizeUserSettings` in shared (at the caller) so a partial or legacy row
 * still yields every field a client expects.
 */
import { logger } from "../../utils/logger";

import type { DataClient } from "./client";

// ============ CUSTOM CATEGORIES ============

export async function getCustomCategories(
  supabase: DataClient,
): Promise<any[]> {
  const { data, error } = await supabase
    .from("custom_categories")
    .select("*")
    .order("usage_count", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createCustomCategory(
  supabase: DataClient,
  name: string,
  userId: string,
): Promise<any> {
  // Upsert: if name exists, return existing
  const { data: existing } = await supabase
    .from("custom_categories")
    .select("*")
    .eq("name", name)
    .single();

  if (existing) return existing;

  const { data, error } = await supabase
    .from("custom_categories")
    .insert({ name, created_by: userId })
    .select()
    .single();

  if (error) {
    // Handle race condition: another insert happened between select and insert
    if (error.code === "23505") {
      const { data: raceData } = await supabase
        .from("custom_categories")
        .select("*")
        .eq("name", name)
        .single();
      return raceData;
    }
    throw error;
  }
  return data;
}

export async function incrementCategoryUsage(
  supabase: DataClient,
  categoryName: string,
): Promise<void> {
  // Increment usage_count by 1 for the given category
  const { data } = await supabase
    .from("custom_categories")
    .select("usage_count")
    .eq("name", categoryName)
    .single();

  if (data) {
    await supabase
      .from("custom_categories")
      .update({ usage_count: (data.usage_count || 0) + 1 })
      .eq("name", categoryName);
  }
}

// ============ USER PREFERENCES ============

export async function getUserPreferences(
  supabase: DataClient,
  userId: string,
): Promise<any | null> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows returned
    logger.error("Error fetching user preferences", { userId, error });
    throw error;
  }

  return data;
}

export async function upsertUserPreferences(
  supabase: DataClient,
  userId: string,
  prefs: { theme?: string; preferences?: Record<string, any> },
): Promise<any> {
  const { data, error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: userId,
        theme: prefs.theme || "light",
        preferences: prefs.preferences || {},
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id",
      },
    )
    .select()
    .single();

  if (error) {
    logger.error("Error upserting user preferences", { userId, error });
    throw error;
  }

  return data;
}
