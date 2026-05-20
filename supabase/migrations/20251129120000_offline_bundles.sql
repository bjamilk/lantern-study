-- Create offline_bundles table for cross-device sync
CREATE TABLE IF NOT EXISTS offline_bundles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bundle_id TEXT NOT NULL,
    config JSONB NOT NULL,
    questions JSONB NOT NULL,
    group_name TEXT NOT NULL,
    downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, bundle_id)
);

-- Create index for faster user lookups
CREATE INDEX idx_offline_bundles_user_id ON offline_bundles(user_id);

-- Enable RLS
ALTER TABLE offline_bundles ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own offline bundles"
    ON offline_bundles FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own offline bundles"
    ON offline_bundles FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own offline bundles"
    ON offline_bundles FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own offline bundles"
    ON offline_bundles FOR DELETE
    USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_offline_bundles_updated_at
    BEFORE UPDATE ON offline_bundles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
