-- Applied automatically by app/src/clothes/drying.ts (ensureClipReadings) at startup.
-- Each clip is identified by its ESP32's Wi-Fi MAC and publishes on clothes/<device_id>/raw.
ALTER TABLE clips ADD COLUMN IF NOT EXISTS device_id TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clips_device_id_format') THEN
    ALTER TABLE clips ADD CONSTRAINT clips_device_id_format CHECK (device_id ~ '^[0-9A-F]{12}$');
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS clips_device_id_key ON clips (device_id) WHERE device_id IS NOT NULL;
-- Which clip a reading came from. Readings stored before this belong to the first real clip.
ALTER TABLE clothes_raw ADD COLUMN IF NOT EXISTS clip_id UUID REFERENCES clips(id);
UPDATE clothes_raw SET clip_id = (SELECT id FROM clips WHERE NOT is_demo ORDER BY created_at, id LIMIT 1) WHERE clip_id IS NULL;
CREATE INDEX IF NOT EXISTS clothes_raw_clip_time_idx ON clothes_raw (clip_id, timestamp DESC, id DESC);
