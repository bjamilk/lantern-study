-- Enable Row Level Security (RLS) and define active access control policies

-- ============================================
-- 1. profiles
-- ============================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;
DROP POLICY IF EXISTS profiles_delete ON public.profiles;

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY profiles_delete ON public.profiles FOR DELETE TO authenticated USING (auth.uid() = id);

-- ============================================
-- 2. groups
-- ============================================
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS groups_select ON public.groups;
DROP POLICY IF EXISTS groups_insert ON public.groups;
DROP POLICY IF EXISTS groups_update ON public.groups;
DROP POLICY IF EXISTS groups_delete ON public.groups;

CREATE POLICY groups_select ON public.groups FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.group_members WHERE group_id = id AND user_id = auth.uid()));
CREATE POLICY groups_insert ON public.groups FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY groups_update ON public.groups FOR UPDATE TO authenticated USING (admin_ids @> jsonb_build_array(auth.uid()::text));
CREATE POLICY groups_delete ON public.groups FOR DELETE TO authenticated USING (admin_ids @> jsonb_build_array(auth.uid()::text));

-- ============================================
-- 3. group_members
-- ============================================
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS group_members_select ON public.group_members;
DROP POLICY IF EXISTS group_members_insert ON public.group_members;
DROP POLICY IF EXISTS group_members_update ON public.group_members;
DROP POLICY IF EXISTS group_members_delete ON public.group_members;

CREATE POLICY group_members_select ON public.group_members FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_id AND gm.user_id = auth.uid()) OR user_id = auth.uid());
CREATE POLICY group_members_insert ON public.group_members FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.admin_ids @> jsonb_build_array(auth.uid()::text)));
CREATE POLICY group_members_update ON public.group_members FOR UPDATE TO authenticated USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.admin_ids @> jsonb_build_array(auth.uid()::text)));
CREATE POLICY group_members_delete ON public.group_members FOR DELETE TO authenticated USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.admin_ids @> jsonb_build_array(auth.uid()::text)));

-- ============================================
-- 4. messages
-- ============================================
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages_select ON public.messages;
DROP POLICY IF EXISTS messages_insert ON public.messages;
DROP POLICY IF EXISTS messages_update ON public.messages;
DROP POLICY IF EXISTS messages_delete ON public.messages;

CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.group_members WHERE group_id = messages.group_id AND user_id = auth.uid()));
CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.group_members WHERE group_id = messages.group_id AND user_id = auth.uid()));
CREATE POLICY messages_update ON public.messages FOR UPDATE TO authenticated USING (sender_id = auth.uid() OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.admin_ids @> jsonb_build_array(auth.uid()::text)));
CREATE POLICY messages_delete ON public.messages FOR DELETE TO authenticated USING (sender_id = auth.uid() OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.admin_ids @> jsonb_build_array(auth.uid()::text)));

-- ============================================
-- 5. question_votes
-- ============================================
ALTER TABLE public.question_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS question_votes_select ON public.question_votes;
DROP POLICY IF EXISTS question_votes_insert ON public.question_votes;
DROP POLICY IF EXISTS question_votes_update ON public.question_votes;
DROP POLICY IF EXISTS question_votes_delete ON public.question_votes;

CREATE POLICY question_votes_select ON public.question_votes FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.messages m JOIN public.group_members gm ON m.group_id = gm.group_id WHERE m.id = message_id AND gm.user_id = auth.uid()));
CREATE POLICY question_votes_insert ON public.question_votes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.messages m JOIN public.group_members gm ON m.group_id = gm.group_id WHERE m.id = message_id AND gm.user_id = auth.uid()));
CREATE POLICY question_votes_update ON public.question_votes FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY question_votes_delete ON public.question_votes FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================
-- 6. dm_threads
-- ============================================
ALTER TABLE public.dm_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dm_threads_select ON public.dm_threads;
DROP POLICY IF EXISTS dm_threads_insert ON public.dm_threads;
DROP POLICY IF EXISTS dm_threads_update ON public.dm_threads;
DROP POLICY IF EXISTS dm_threads_delete ON public.dm_threads;

CREATE POLICY dm_threads_select ON public.dm_threads FOR SELECT TO authenticated USING (participant_ids @> jsonb_build_array(auth.uid()::text));
CREATE POLICY dm_threads_insert ON public.dm_threads FOR INSERT TO authenticated WITH CHECK (participant_ids @> jsonb_build_array(auth.uid()::text));
CREATE POLICY dm_threads_update ON public.dm_threads FOR UPDATE TO authenticated USING (participant_ids @> jsonb_build_array(auth.uid()::text)) WITH CHECK (participant_ids @> jsonb_build_array(auth.uid()::text));
CREATE POLICY dm_threads_delete ON public.dm_threads FOR DELETE TO authenticated USING (participant_ids @> jsonb_build_array(auth.uid()::text));

-- ============================================
-- 7. dm_messages
-- ============================================
ALTER TABLE public.dm_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dm_messages_select ON public.dm_messages;
DROP POLICY IF EXISTS dm_messages_insert ON public.dm_messages;
DROP POLICY IF EXISTS dm_messages_update ON public.dm_messages;
DROP POLICY IF EXISTS dm_messages_delete ON public.dm_messages;

CREATE POLICY dm_messages_select ON public.dm_messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.dm_threads WHERE id = thread_id AND participant_ids @> jsonb_build_array(auth.uid()::text)));
CREATE POLICY dm_messages_insert ON public.dm_messages FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.dm_threads WHERE id = thread_id AND participant_ids @> jsonb_build_array(auth.uid()::text)));
CREATE POLICY dm_messages_update ON public.dm_messages FOR UPDATE TO authenticated USING (sender_id = auth.uid());
CREATE POLICY dm_messages_delete ON public.dm_messages FOR DELETE TO authenticated USING (sender_id = auth.uid());

-- ============================================
-- 8. dm_read_status
-- ============================================
ALTER TABLE public.dm_read_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dm_read_status_select ON public.dm_read_status;
DROP POLICY IF EXISTS dm_read_status_insert ON public.dm_read_status;
DROP POLICY IF EXISTS dm_read_status_update ON public.dm_read_status;
DROP POLICY IF EXISTS dm_read_status_delete ON public.dm_read_status;

CREATE POLICY dm_read_status_select ON public.dm_read_status FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY dm_read_status_insert ON public.dm_read_status FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY dm_read_status_update ON public.dm_read_status FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY dm_read_status_delete ON public.dm_read_status FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================
-- 9. test_sessions
-- ============================================
ALTER TABLE public.test_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS test_sessions_select ON public.test_sessions;
DROP POLICY IF EXISTS test_sessions_insert ON public.test_sessions;
DROP POLICY IF EXISTS test_sessions_update ON public.test_sessions;
DROP POLICY IF EXISTS test_sessions_delete ON public.test_sessions;

CREATE POLICY test_sessions_select ON public.test_sessions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY test_sessions_insert ON public.test_sessions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY test_sessions_update ON public.test_sessions FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY test_sessions_delete ON public.test_sessions FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================
-- 10. test_results
-- ============================================
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS test_results_select ON public.test_results;
DROP POLICY IF EXISTS test_results_insert ON public.test_results;
DROP POLICY IF EXISTS test_results_update ON public.test_results;
DROP POLICY IF EXISTS test_results_delete ON public.test_results;

CREATE POLICY test_results_select ON public.test_results FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.test_sessions WHERE id = session_id AND user_id = auth.uid()));
CREATE POLICY test_results_insert ON public.test_results FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.test_sessions WHERE id = session_id AND user_id = auth.uid()));
CREATE POLICY test_results_update ON public.test_results FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.test_sessions WHERE id = session_id AND user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.test_sessions WHERE id = session_id AND user_id = auth.uid()));
CREATE POLICY test_results_delete ON public.test_results FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.test_sessions WHERE id = session_id AND user_id = auth.uid()));

-- ============================================
-- 11. decks
-- ============================================
ALTER TABLE public.decks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decks_select ON public.decks;
DROP POLICY IF EXISTS decks_insert ON public.decks;
DROP POLICY IF EXISTS decks_update ON public.decks;
DROP POLICY IF EXISTS decks_delete ON public.decks;

CREATE POLICY decks_select ON public.decks FOR SELECT TO authenticated USING (user_id = auth.uid() OR created_by = auth.uid() OR is_shared = true OR EXISTS (SELECT 1 FROM public.deck_collaborators WHERE deck_id = id AND user_id = auth.uid()));
CREATE POLICY decks_insert ON public.decks FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR created_by = auth.uid());
CREATE POLICY decks_update ON public.decks FOR UPDATE TO authenticated USING (user_id = auth.uid() OR created_by = auth.uid() OR EXISTS (SELECT 1 FROM public.deck_collaborators WHERE deck_id = id AND user_id = auth.uid() AND role IN ('editor', 'owner')));
CREATE POLICY decks_delete ON public.decks FOR DELETE TO authenticated USING (user_id = auth.uid() OR created_by = auth.uid());

-- ============================================
-- 12. deck_collaborators
-- ============================================
ALTER TABLE public.deck_collaborators ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deck_collaborators_select ON public.deck_collaborators;
DROP POLICY IF EXISTS deck_collaborators_insert ON public.deck_collaborators;
DROP POLICY IF EXISTS deck_collaborators_update ON public.deck_collaborators;
DROP POLICY IF EXISTS deck_collaborators_delete ON public.deck_collaborators;

CREATE POLICY deck_collaborators_select ON public.deck_collaborators FOR SELECT TO authenticated USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.decks WHERE id = deck_id AND (user_id = auth.uid() OR created_by = auth.uid() OR EXISTS (SELECT 1 FROM public.deck_collaborators dc WHERE dc.deck_id = deck_collaborators.deck_id AND dc.user_id = auth.uid()))));
CREATE POLICY deck_collaborators_insert ON public.deck_collaborators FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.decks WHERE id = deck_id AND (user_id = auth.uid() OR created_by = auth.uid())));
CREATE POLICY deck_collaborators_update ON public.deck_collaborators FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.decks WHERE id = deck_id AND (user_id = auth.uid() OR created_by = auth.uid())));
CREATE POLICY deck_collaborators_delete ON public.deck_collaborators FOR DELETE TO authenticated USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.decks WHERE id = deck_id AND (user_id = auth.uid() OR created_by = auth.uid())));

-- ============================================
-- 13. flashcards
-- ============================================
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flashcards_select ON public.flashcards;
DROP POLICY IF EXISTS flashcards_insert ON public.flashcards;
DROP POLICY IF EXISTS flashcards_update ON public.flashcards;
DROP POLICY IF EXISTS flashcards_delete ON public.flashcards;

CREATE POLICY flashcards_select ON public.flashcards FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.decks WHERE id = deck_id));
CREATE POLICY flashcards_insert ON public.flashcards FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.decks WHERE id = deck_id AND (user_id = auth.uid() OR created_by = auth.uid() OR EXISTS (SELECT 1 FROM public.deck_collaborators WHERE deck_id = flashcards.deck_id AND user_id = auth.uid() AND role IN ('editor', 'owner')))));
CREATE POLICY flashcards_update ON public.flashcards FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.decks WHERE id = deck_id AND (user_id = auth.uid() OR created_by = auth.uid() OR EXISTS (SELECT 1 FROM public.deck_collaborators WHERE deck_id = flashcards.deck_id AND user_id = auth.uid() AND role IN ('editor', 'owner')))));
CREATE POLICY flashcards_delete ON public.flashcards FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.decks WHERE id = deck_id AND (user_id = auth.uid() OR created_by = auth.uid() OR EXISTS (SELECT 1 FROM public.deck_collaborators WHERE deck_id = flashcards.deck_id AND user_id = auth.uid() AND role IN ('editor', 'owner')))));

-- ============================================
-- 14. flashcard_comments
-- ============================================
ALTER TABLE public.flashcard_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flashcard_comments_select ON public.flashcard_comments;
DROP POLICY IF EXISTS flashcard_comments_insert ON public.flashcard_comments;
DROP POLICY IF EXISTS flashcard_comments_update ON public.flashcard_comments;
DROP POLICY IF EXISTS flashcard_comments_delete ON public.flashcard_comments;

CREATE POLICY flashcard_comments_select ON public.flashcard_comments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.flashcards f JOIN public.decks d ON f.deck_id = d.id WHERE f.id = flashcard_id));
CREATE POLICY flashcard_comments_insert ON public.flashcard_comments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.flashcards f JOIN public.decks d ON f.deck_id = d.id WHERE f.id = flashcard_id));
CREATE POLICY flashcard_comments_update ON public.flashcard_comments FOR UPDATE TO authenticated USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.flashcards f JOIN public.decks d ON f.deck_id = d.id WHERE f.id = flashcard_id AND (d.user_id = auth.uid() OR d.created_by = auth.uid())));
CREATE POLICY flashcard_comments_delete ON public.flashcard_comments FOR DELETE TO authenticated USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.flashcards f JOIN public.decks d ON f.deck_id = d.id WHERE f.id = flashcard_id AND (d.user_id = auth.uid() OR d.created_by = auth.uid())));

-- ============================================
-- 15. study_sessions
-- ============================================
ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS study_sessions_select ON public.study_sessions;
DROP POLICY IF EXISTS study_sessions_insert ON public.study_sessions;
DROP POLICY IF EXISTS study_sessions_update ON public.study_sessions;
DROP POLICY IF EXISTS study_sessions_delete ON public.study_sessions;

CREATE POLICY study_sessions_select ON public.study_sessions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.decks WHERE id = deck_id));
CREATE POLICY study_sessions_insert ON public.study_sessions FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY study_sessions_update ON public.study_sessions FOR UPDATE TO authenticated USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM public.decks WHERE id = deck_id AND (user_id = auth.uid() OR created_by = auth.uid() OR EXISTS (SELECT 1 FROM public.deck_collaborators WHERE deck_id = study_sessions.deck_id AND user_id = auth.uid()))));
CREATE POLICY study_sessions_delete ON public.study_sessions FOR DELETE TO authenticated USING (created_by = auth.uid());

-- ============================================
-- 16. study_session_participants
-- ============================================
ALTER TABLE public.study_session_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS study_session_participants_select ON public.study_session_participants;
DROP POLICY IF EXISTS study_session_participants_insert ON public.study_session_participants;
DROP POLICY IF EXISTS study_session_participants_update ON public.study_session_participants;
DROP POLICY IF EXISTS study_session_participants_delete ON public.study_session_participants;

CREATE POLICY study_session_participants_select ON public.study_session_participants FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.study_sessions WHERE id = session_id));
CREATE POLICY study_session_participants_insert ON public.study_session_participants FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY study_session_participants_update ON public.study_session_participants FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY study_session_participants_delete ON public.study_session_participants FOR DELETE TO authenticated USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.study_sessions WHERE id = session_id AND created_by = auth.uid()));

-- ============================================
-- 17. transactions
-- ============================================
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transactions_select ON public.transactions;
DROP POLICY IF EXISTS transactions_insert ON public.transactions;
DROP POLICY IF EXISTS transactions_update ON public.transactions;
DROP POLICY IF EXISTS transactions_delete ON public.transactions;

CREATE POLICY transactions_select ON public.transactions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY transactions_insert ON public.transactions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY transactions_update ON public.transactions FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY transactions_delete ON public.transactions FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================
-- 18. budgets
-- ============================================
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budgets_select ON public.budgets;
DROP POLICY IF EXISTS budgets_insert ON public.budgets;
DROP POLICY IF EXISTS budgets_update ON public.budgets;
DROP POLICY IF EXISTS budgets_delete ON public.budgets;

CREATE POLICY budgets_select ON public.budgets FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY budgets_insert ON public.budgets FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY budgets_update ON public.budgets FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY budgets_delete ON public.budgets FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================
-- 19. notifications
-- ============================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_select ON public.notifications;
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
DROP POLICY IF EXISTS notifications_update ON public.notifications;
DROP POLICY IF EXISTS notifications_delete ON public.notifications;

CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY notifications_insert ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY notifications_delete ON public.notifications FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================
-- 20. user_question_stats
-- ============================================
ALTER TABLE public.user_question_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_question_stats_select ON public.user_question_stats;
DROP POLICY IF EXISTS user_question_stats_insert ON public.user_question_stats;
DROP POLICY IF EXISTS user_question_stats_update ON public.user_question_stats;
DROP POLICY IF EXISTS user_question_stats_delete ON public.user_question_stats;

CREATE POLICY user_question_stats_select ON public.user_question_stats FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_question_stats_insert ON public.user_question_stats FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY user_question_stats_update ON public.user_question_stats FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY user_question_stats_delete ON public.user_question_stats FOR DELETE TO authenticated USING (user_id = auth.uid());
