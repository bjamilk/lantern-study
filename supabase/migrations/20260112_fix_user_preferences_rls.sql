-- Add RLS policies for user_preferences table

-- Enable RLS on user_preferences if not already enabled
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can insert own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can update own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can delete own preferences" ON user_preferences;

-- Allow users to read their own preferences
CREATE POLICY "Users can view own preferences" ON user_preferences 
  FOR SELECT USING (auth.uid() = user_id);

-- Allow users to insert their own preferences
CREATE POLICY "Users can insert own preferences" ON user_preferences 
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own preferences
CREATE POLICY "Users can update own preferences" ON user_preferences 
  FOR UPDATE USING (auth.uid() = user_id);

-- Allow users to delete their own preferences
CREATE POLICY "Users can delete own preferences" ON user_preferences 
  FOR DELETE USING (auth.uid() = user_id);
