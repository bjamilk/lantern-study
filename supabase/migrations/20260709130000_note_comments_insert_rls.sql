-- Tighten note_comments INSERT so authors can only comment on notes they can read.

DROP POLICY IF EXISTS note_comments_insert ON public.note_comments;

CREATE POLICY note_comments_insert ON public.note_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.notes n
      WHERE n.id = note_id
        AND (
          n.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.note_collaborators nc
            WHERE nc.note_id = n.id AND nc.user_id = auth.uid()
          )
          OR (
            n.group_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.group_members gm
              WHERE gm.group_id = n.group_id
                AND gm.user_id = auth.uid()
                AND COALESCE(gm.pending, false) = false
            )
          )
        )
    )
  );
