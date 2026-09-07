-- Atomic deck + cards creation.
--
-- Why: a deck generated from a note/job was written in two steps (insert deck,
-- then insert cards). An interrupted client (airplane mode, process death)
-- left the deck row behind with zero cards, and the mobile rollback could only
-- delete its LOCAL copy — the server kept an empty "From: <note> · 0 cards"
-- deck forever. One transaction removes the window entirely.
--
-- The API feature-detects this function: while the migration is unapplied the
-- route falls back to insert-deck → insert-cards → DELETE the deck on any card
-- failure, so an empty deck cannot survive either way. Applying this migration
-- only makes the guarantee atomic rather than compensating.

CREATE OR REPLACE FUNCTION public.create_deck_with_cards(
  p_owner uuid,
  p_deck jsonb,
  p_cards jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deck_id uuid;
  v_card_ids uuid[] := ARRAY[]::uuid[];
  v_card jsonb;
  v_card_id uuid;
  v_type text;
  v_has_topic boolean;
BEGIN
  IF p_owner IS NULL THEN
    RAISE EXCEPTION 'owner is required' USING ERRCODE = '22023';
  END IF;

  -- An empty card array would produce exactly the empty deck this function
  -- exists to prevent, so it is rejected before anything is written.
  IF p_cards IS NULL
     OR jsonb_typeof(p_cards) <> 'array'
     OR jsonb_array_length(p_cards) = 0 THEN
    RAISE EXCEPTION 'EMPTY_CARDS' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.decks (user_id, name, description, is_shared, course_id)
  VALUES (
    p_owner,
    COALESCE(NULLIF(btrim(p_deck->>'name'), ''), 'Untitled deck'),
    COALESCE(p_deck->>'description', ''),
    COALESCE((p_deck->>'is_shared')::boolean, false),
    NULLIF(p_deck->>'course_id', '')::uuid
  )
  RETURNING id INTO v_deck_id;

  -- decks.topic_id arrives with 20260826120000; naming it unconditionally
  -- would 42703 the whole call on a database that has not applied that yet.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'decks' AND column_name = 'topic_id'
  ) INTO v_has_topic;

  IF v_has_topic AND NULLIF(p_deck->>'topic_id', '') IS NOT NULL THEN
    EXECUTE 'UPDATE public.decks SET topic_id = $2 WHERE id = $1'
      USING v_deck_id, (p_deck->>'topic_id')::uuid;
  END IF;

  FOR v_card IN SELECT value FROM jsonb_array_elements(p_cards) LOOP
    v_type := COALESCE(NULLIF(v_card->>'type', ''), 'BASIC');

    INSERT INTO public.flashcards (
      deck_id, type, front, back, cloze_text, image_url, occlusion_data, tags
    )
    VALUES (
      v_deck_id,
      v_type,
      -- The check_flashcard_fields constraint requires front/back NULL on a
      -- CLOZE card and back NULL on an occlusion card; mirroring it here keeps
      -- a malformed card a 23514, which rolls the whole call back.
      CASE WHEN v_type = 'CLOZE' THEN NULL ELSE NULLIF(v_card->>'front', '') END,
      CASE WHEN v_type IN ('CLOZE', 'IMAGE_OCCLUSION') THEN NULL ELSE NULLIF(v_card->>'back', '') END,
      CASE WHEN v_type = 'CLOZE' THEN NULLIF(v_card->>'clozeText', '') ELSE NULL END,
      NULLIF(v_card->>'imageUrl', ''),
      CASE WHEN jsonb_typeof(v_card->'occlusionData') = 'object' THEN v_card->'occlusionData' ELSE NULL END,
      CASE WHEN jsonb_typeof(v_card->'tags') = 'array' THEN v_card->'tags' ELSE '[]'::jsonb END
    )
    RETURNING id INTO v_card_id;

    v_card_ids := v_card_ids || v_card_id;
  END LOOP;

  RETURN jsonb_build_object(
    'deckId', v_deck_id,
    'cardIds', to_jsonb(v_card_ids),
    'cardCount', array_length(v_card_ids, 1)
  );
END;
$$;

-- Callers reach this only through the service role: the API route enforces
-- ownership and the card cap before calling, and the function itself trusts
-- p_owner. It is deliberately NOT granted to authenticated — a client could
-- otherwise pass any p_owner and write decks into another account.
REVOKE ALL ON FUNCTION public.create_deck_with_cards(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_deck_with_cards(uuid, jsonb, jsonb) TO service_role;
