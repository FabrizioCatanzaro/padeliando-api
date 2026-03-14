-- Migración: separar jugadores anónimos de usuarios registrados
-- Ejecutar UNA vez contra la DB existente

-- 1. Quitar el constraint de unicidad global en players.name
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_name_key;

-- 2. Agregar user_id a players (FK nullable a users)
ALTER TABLE players ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

-- 3. Crear tabla de invitaciones
CREATE TABLE IF NOT EXISTS player_invitations (
  id                 TEXT PRIMARY KEY,
  player_id          TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  group_id           TEXT NOT NULL REFERENCES groups(id)  ON DELETE CASCADE,
  invited_by         TEXT NOT NULL REFERENCES users(id),
  invited_identifier TEXT NOT NULL,
  invited_user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Índices
CREATE INDEX IF NOT EXISTS idx_invitations_user   ON player_invitations(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_player ON player_invitations(player_id);
