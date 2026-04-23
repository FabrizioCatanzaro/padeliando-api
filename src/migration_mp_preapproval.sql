-- Migración: agregar columna mp_preapproval_id a subscriptions
-- Ejecutar una sola vez en bases de datos existentes

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS mp_preapproval_id TEXT UNIQUE;

-- También agregar estado 'pending' al CHECK de status
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('active', 'cancelled', 'expired', 'pending'));
