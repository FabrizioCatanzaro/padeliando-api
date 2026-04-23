-- Migración: agregar tabla de suscripciones
-- Ejecutar una sola vez en bases de datos existentes

CREATE TABLE IF NOT EXISTS subscriptions (
  id             TEXT        PRIMARY KEY,
  user_id        TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan           TEXT        NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'premium')),
  billing_period TEXT
    CHECK (billing_period IN ('monthly', 'quarterly', 'annual', 'trial')),
  status         TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'expired')),
  starts_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
