-- Add link column to notifications table
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;
