-- Migración: avatares de usuarios + galería de fotos por jornada
-- Ejecutar una sola vez en bases de datos existentes

-- Avatar de usuario (cualquier usuario puede tenerlo)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_public_id TEXT;

-- Fotos de jornada (solo usuarios premium pueden subirlas)
CREATE TABLE IF NOT EXISTS tournament_photos (
  id            TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  uploaded_by   TEXT NOT NULL REFERENCES users(id),
  url           TEXT NOT NULL,
  public_id     TEXT NOT NULL,
  caption       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournament_photos_tournament
  ON tournament_photos(tournament_id);
