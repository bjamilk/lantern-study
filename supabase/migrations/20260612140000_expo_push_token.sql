-- Store Expo push notification tokens for mobile clients
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS expo_push_token TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_expo_push_token ON profiles(expo_push_token) WHERE expo_push_token IS NOT NULL;
