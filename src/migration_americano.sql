-- Migración: soporte para formato Americano en torneos
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS format  TEXT NOT NULL DEFAULT 'liga';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS bracket JSONB;
