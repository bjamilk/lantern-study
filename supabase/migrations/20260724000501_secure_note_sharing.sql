-- Secure note sharing: hashed share links, redemptions, copy provenance, atomic accept.

-- Copy provenance (detached personal copies)
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS copied_from_note_id UUID REFERENCES public.notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notes_copied_from
  ON public.notes (copied_from_note_id)
  WHERE copied_from_note_id IS NOT NULL;

COMMENT ON COLUMN public.notes.copied_from_note_id IS
  'Source note id when this note was created via Make a copy. Null for originals.';

-- Do not reuse plaintext notes.share_token for secure links.
COMMENT ON COLUMN public.notes.share_token IS
  'Dormant legacy field. Do not use for secure share links; use note_share_links.token_hash.';

-- Owner-created share links (plaintext token never stored)
CREATE TABLE IF NOT EXISTS public.note_share_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_redeemed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_note_share_links_note_active
  ON public.note_share_links (note_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_note_share_links_created_by
  ON public.note_share_links (created_by);

-- Redemption audit (one row per user per link)
CREATE TABLE IF NOT EXISTS public.note_share_redemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  share_link_id UUID NOT NULL REFERENCES public.note_share_links(id) ON DELETE CASCADE,
  note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  redeemer_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_role TEXT NOT NULL CHECK (granted_role IN ('viewer', 'editor')),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (share_link_id, redeemer_user_id)
);

CREATE INDEX IF NOT EXISTS idx_note_share_redemptions_redeemer
  ON public.note_share_redemptions (redeemer_user_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS idx_note_share_redemptions_note
  ON public.note_share_redemptions (note_id);

-- Service-role only: deny PostgREST client roles
ALTER TABLE public.note_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_share_redemptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.note_share_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.note_share_redemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.note_share_links TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.note_share_redemptions TO service_role;

-- Explicit deny policies (defense in depth; service_role bypasses RLS)
DROP POLICY IF EXISTS note_share_links_deny_all ON public.note_share_links;
CREATE POLICY note_share_links_deny_all ON public.note_share_links
  FOR ALL TO authenticated, anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS note_share_redemptions_deny_all ON public.note_share_redemptions;
CREATE POLICY note_share_redemptions_deny_all ON public.note_share_redemptions
  FOR ALL TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- Allow owners to update collaborator roles via authenticated clients (API uses service_role;
-- keep RLS consistent for future direct access).
DROP POLICY IF EXISTS note_collaborators_update ON public.note_collaborators;
CREATE POLICY note_collaborators_update ON public.note_collaborators
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.notes n
      WHERE n.id = note_id AND n.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.notes n
      WHERE n.id = note_id AND n.user_id = auth.uid()
    )
    AND role IN ('viewer', 'editor')
  );

-- Editors may add attachments (API still enforces canEdit); previously owner-only INSERT.
DROP POLICY IF EXISTS note_attachments_insert ON public.note_attachments;
CREATE POLICY note_attachments_insert ON public.note_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.notes n
      WHERE n.id = note_id
        AND (
          n.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.note_collaborators nc
            WHERE nc.note_id = n.id
              AND nc.user_id = auth.uid()
              AND nc.role IN ('editor', 'owner')
          )
        )
    )
  );

DROP POLICY IF EXISTS note_attachments_update ON public.note_attachments;
CREATE POLICY note_attachments_update ON public.note_attachments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.notes n
      WHERE n.id = note_id
        AND (
          n.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.note_collaborators nc
            WHERE nc.note_id = n.id
              AND nc.user_id = auth.uid()
              AND nc.role IN ('editor', 'owner')
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.notes n
      WHERE n.id = note_id
        AND (
          n.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.note_collaborators nc
            WHERE nc.note_id = n.id
              AND nc.user_id = auth.uid()
              AND nc.role IN ('editor', 'owner')
          )
        )
    )
  );

/**
 * Atomically accept a share link by token hash.
 * - SECURITY INVOKER (no privilege escalation)
 * - Executable only by service_role
 * - Never downgrades an existing editor to viewer
 * - Idempotent for the same (link, user)
 */
CREATE OR REPLACE FUNCTION public.accept_note_share_link(
  p_token_hash TEXT,
  p_user_id UUID
)
RETURNS TABLE (
  note_id UUID,
  granted_role TEXT,
  already_accepted BOOLEAN,
  share_link_id UUID
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_link public.note_share_links%ROWTYPE;
  v_existing_role TEXT;
  v_grant TEXT;
  v_already BOOLEAN := FALSE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_token_hash IS NULL OR length(p_token_hash) < 32 OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_link
  FROM public.note_share_links
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'share_link_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_link.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'share_link_revoked' USING ERRCODE = 'P0001';
  END IF;

  IF v_link.expires_at IS NOT NULL AND v_link.expires_at <= NOW() THEN
    RAISE EXCEPTION 'share_link_expired' USING ERRCODE = 'P0001';
  END IF;

  -- Owner accepting their own link is a no-op grant
  IF EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.id = v_link.note_id AND n.user_id = p_user_id
  ) THEN
    note_id := v_link.note_id;
    granted_role := 'owner';
    already_accepted := TRUE;
    share_link_id := v_link.id;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT nc.role INTO v_existing_role
  FROM public.note_collaborators nc
  WHERE nc.note_id = v_link.note_id AND nc.user_id = p_user_id
  FOR UPDATE;

  v_grant := v_link.role;
  IF v_existing_role = 'editor' AND v_grant = 'viewer' THEN
    v_grant := 'editor';
  END IF;
  IF v_existing_role = 'owner' THEN
    v_grant := 'owner';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.note_share_redemptions r
    WHERE r.share_link_id = v_link.id AND r.redeemer_user_id = p_user_id
  ) INTO v_already;

  INSERT INTO public.note_collaborators (note_id, user_id, role)
  VALUES (v_link.note_id, p_user_id, v_grant)
  ON CONFLICT (note_id, user_id) DO UPDATE
    SET role = CASE
      WHEN note_collaborators.role = 'editor' AND EXCLUDED.role = 'viewer' THEN 'editor'
      WHEN note_collaborators.role = 'owner' THEN 'owner'
      ELSE EXCLUDED.role
    END;

  INSERT INTO public.note_share_redemptions (
    share_link_id, note_id, redeemer_user_id, granted_role
  )
  VALUES (v_link.id, v_link.note_id, p_user_id, v_grant)
  ON CONFLICT (share_link_id, redeemer_user_id) DO UPDATE
    SET granted_role = CASE
      WHEN note_share_redemptions.granted_role = 'editor' AND EXCLUDED.granted_role = 'viewer'
        THEN 'editor'
      ELSE EXCLUDED.granted_role
    END;

  UPDATE public.note_share_links
  SET last_redeemed_at = NOW()
  WHERE id = v_link.id;

  note_id := v_link.note_id;
  granted_role := v_grant;
  already_accepted := v_already;
  share_link_id := v_link.id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_note_share_link(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_note_share_link(TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_note_share_link(TEXT, UUID) TO service_role;

COMMENT ON FUNCTION public.accept_note_share_link(TEXT, UUID) IS
  'Service-role-only atomic accept for hashed note share links. Never downgrades editor to viewer.';

COMMENT ON TABLE public.note_share_links IS
  'Owner-created note share links. Stores SHA-256 token hashes only; API holds plaintext once at creation.';

COMMENT ON TABLE public.note_share_redemptions IS
  'Audit of share-link acceptances. Unique per (link, redeemer).';
