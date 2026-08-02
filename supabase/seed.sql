-- Seed mock users for development
-- Note: In production, users should be created through Supabase auth
-- Password for all test users: "password123"

-- Insert mock users into auth.users first
-- The encrypted_password is bcrypt hash of "password123"
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change) VALUES
('00000000-0000-0000-0000-000000000000', '550e8400-e29b-41d4-a716-446655440000', 'authenticated', 'authenticated', 'alice@example.com', '$2a$10$JR99WwhsoC69d35RQSjeXOCRclC/kCN8Rp0Dmj4i9hljvEY5/w7FG', NOW(), NOW(), NOW(), '{"provider":"email","providers":["email"]}', '{"name":"Alice Johnson"}', false, '', '', '', ''),
('00000000-0000-0000-0000-000000000000', '550e8400-e29b-41d4-a716-446655440001', 'authenticated', 'authenticated', 'bob@example.com', '$2a$10$JR99WwhsoC69d35RQSjeXOCRclC/kCN8Rp0Dmj4i9hljvEY5/w7FG', NOW(), NOW(), NOW(), '{"provider":"email","providers":["email"]}', '{"name":"Bob Smith"}', false, '', '', '', ''),
('00000000-0000-0000-0000-000000000000', '550e8400-e29b-41d4-a716-446655440002', 'authenticated', 'authenticated', 'charlie@example.com', '$2a$10$JR99WwhsoC69d35RQSjeXOCRclC/kCN8Rp0Dmj4i9hljvEY5/w7FG', NOW(), NOW(), NOW(), '{"provider":"email","providers":["email"]}', '{"name":"Charlie Brown"}', false, '', '', '', ''),
('00000000-0000-0000-0000-000000000000', '550e8400-e29b-41d4-a716-446655440003', 'authenticated', 'authenticated', 'diana@example.com', '$2a$10$JR99WwhsoC69d35RQSjeXOCRclC/kCN8Rp0Dmj4i9hljvEY5/w7FG', NOW(), NOW(), NOW(), '{"provider":"email","providers":["email"]}', '{"name":"Diana Prince"}', false, '', '', '', ''),
('00000000-0000-0000-0000-000000000000', '1958369a-18cb-47ae-ae9a-124f93b2ee11', 'authenticated', 'authenticated', 'dev1@example.com', '$2a$10$JR99WwhsoC69d35RQSjeXOCRclC/kCN8Rp0Dmj4i9hljvEY5/w7FG', NOW(), NOW(), NOW(), '{"provider":"email","providers":["email"]}', '{"name":"Dev User 1"}', false, '', '', '', ''),
('00000000-0000-0000-0000-000000000000', '47774319-52c9-4162-98ba-defe3b1c72c1', 'authenticated', 'authenticated', 'dev2@example.com', '$2a$10$JR99WwhsoC69d35RQSjeXOCRclC/kCN8Rp0Dmj4i9hljvEY5/w7FG', NOW(), NOW(), NOW(), '{"provider":"email","providers":["email"]}', '{"name":"Dev User 2"}', false, '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Insert identities for each user (required by Supabase Auth)
INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at) VALUES
('550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440000', '{"sub":"550e8400-e29b-41d4-a716-446655440000","email":"alice@example.com"}', 'email', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW(), NOW()),
('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440001', '{"sub":"550e8400-e29b-41d4-a716-446655440001","email":"bob@example.com"}', 'email', '550e8400-e29b-41d4-a716-446655440001', NOW(), NOW(), NOW()),
('550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440002', '{"sub":"550e8400-e29b-41d4-a716-446655440002","email":"charlie@example.com"}', 'email', '550e8400-e29b-41d4-a716-446655440002', NOW(), NOW(), NOW()),
('550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440003', '{"sub":"550e8400-e29b-41d4-a716-446655440003","email":"diana@example.com"}', 'email', '550e8400-e29b-41d4-a716-446655440003', NOW(), NOW(), NOW()),
('1958369a-18cb-47ae-ae9a-124f93b2ee11', '1958369a-18cb-47ae-ae9a-124f93b2ee11', '{"sub":"1958369a-18cb-47ae-ae9a-124f93b2ee11","email":"dev1@example.com"}', 'email', '1958369a-18cb-47ae-ae9a-124f93b2ee11', NOW(), NOW(), NOW()),
('47774319-52c9-4162-98ba-defe3b1c72c1', '47774319-52c9-4162-98ba-defe3b1c72c1', '{"sub":"47774319-52c9-4162-98ba-defe3b1c72c1","email":"dev2@example.com"}', 'email', '47774319-52c9-4162-98ba-defe3b1c72c1', NOW(), NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert mock users into profiles (profiles are auto-created by the on_auth_user_created
-- trigger, so upsert to apply the richer seed data instead of erroring on duplicates).
INSERT INTO profiles (id, name, avatar_url, phone, points, stats, settings, badges) VALUES
('550e8400-e29b-41d4-a716-446655440000', 'Alice Johnson', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alice', '+1234567890', 150, '{"tests_taken": 5, "average_score": 85}', '{}', '["First Test", "Study Streak"]'),
('550e8400-e29b-41d4-a716-446655440001', 'Bob Smith', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Bob', '+1234567891', 200, '{"tests_taken": 8, "average_score": 90}', '{}', '["Top Scorer", "Group Leader"]'),
('550e8400-e29b-41d4-a716-446655440002', 'Charlie Brown', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Charlie', '+1234567892', 120, '{"tests_taken": 3, "average_score": 78}', '{}', '["Quick Learner"]'),
('550e8400-e29b-41d4-a716-446655440003', 'Diana Prince', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Diana', '+1234567893', 180, '{"tests_taken": 6, "average_score": 88}', '{}', '["Consistent Performer"]'),
('1958369a-18cb-47ae-ae9a-124f93b2ee11', 'Dev User 1', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Dev1', '+1234567894', 10, '{"tests_taken": 0, "average_score": 0}', '{}', '[]'),
('47774319-52c9-4162-98ba-defe3b1c72c1', 'Dev User 2', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Dev2', '+1234567895', 10, '{"tests_taken": 0, "average_score": 0}', '{}', '[]')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  avatar_url = EXCLUDED.avatar_url,
  phone = EXCLUDED.phone,
  points = EXCLUDED.points,
  stats = EXCLUDED.stats,
  settings = EXCLUDED.settings,
  badges = EXCLUDED.badges;