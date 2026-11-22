-- Applied automatically by app/src/clothes/resistance.ts (ensureResistanceSchema) at startup.
-- The divider resistor and open-circuit ADS1115 reading of a clip, from `since` on, used to show
-- the fabric resistance in ohms. Readings stay raw counts in clothes_raw.
CREATE TABLE IF NOT EXISTS clip_dividers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  since TIMESTAMPTZ NOT NULL,
  divider_ohm INTEGER NOT NULL CHECK (divider_ohm BETWEEN 1000 AND 100000000),
  open_count INTEGER NOT NULL CHECK (open_count BETWEEN 1000 AND 32767),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clip_id, since)
);
