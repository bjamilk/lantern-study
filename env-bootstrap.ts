/** Runs before other app modules so shared config can read production URLs. */
Object.assign(globalThis, {
  __LANTERN_VITE_SUPABASE_URL__: import.meta.env.VITE_SUPABASE_URL,
  __LANTERN_VITE_SUPABASE_ANON_KEY__: import.meta.env.VITE_SUPABASE_ANON_KEY,
  __LANTERN_VITE_API_URL__: import.meta.env.VITE_API_URL,
});
