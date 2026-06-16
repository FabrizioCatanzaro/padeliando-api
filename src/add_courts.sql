ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS number_of_courts integer NOT NULL DEFAULT 1;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS court integer;
