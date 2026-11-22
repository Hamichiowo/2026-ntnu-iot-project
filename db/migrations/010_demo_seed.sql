-- Applied automatically by app/src/clothes/drying.ts (ensureDryingSchema) at startup.
-- Demo sessions keep the seed of their simulated sensor curves (web/src/utils/demoSensor.ts).
ALTER TABLE drying_sessions ADD COLUMN IF NOT EXISTS demo_seed INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drying_sessions_demo_seed_demo_only') THEN
    ALTER TABLE drying_sessions ADD CONSTRAINT drying_sessions_demo_seed_demo_only CHECK (demo_seed IS NULL OR is_demo);
  END IF;
END $$;
