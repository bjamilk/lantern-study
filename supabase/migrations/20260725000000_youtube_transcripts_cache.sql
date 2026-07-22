-- YouTube transcript cache: one row per video, shared across all users.
-- Written only by the API server (service role); no client access.

CREATE TABLE IF NOT EXISTS public.youtube_transcripts (
  video_id text PRIMARY KEY,
  language text,
  source text NOT NULL DEFAULT 'innertube', -- 'innertube' | 'supadata'
  transcript_text text NOT NULL,
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.youtube_transcripts ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: only the service role key may read/write this table.

COMMENT ON TABLE public.youtube_transcripts IS
  'Cache of fetched YouTube transcripts keyed by video id. Service-role only.';
