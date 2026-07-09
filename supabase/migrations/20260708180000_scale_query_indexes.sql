-- High-traffic query indexes for scale (idempotent)
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles (username);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_members_group_user ON public.group_members (group_id, user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_seller_status ON public.marketplace_listings (user_id, status);
