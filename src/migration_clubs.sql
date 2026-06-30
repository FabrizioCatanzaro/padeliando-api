-- Clubes: lugares donde se juegan los torneos. Solo el admin los gestiona.
CREATE TABLE IF NOT EXISTS clubs (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  photo_url        TEXT,
  photo_public_id  TEXT,
  social_links     JSONB NOT NULL DEFAULT '[]',   -- array de { platform, url }
  contact_phone    TEXT,
  contact_whatsapp TEXT,
  location_name    TEXT,
  lat              DOUBLE PRECISION,
  lon              DOUBLE PRECISION,
  courts           INTEGER,
  schedule         JSONB NOT NULL DEFAULT '[]',    -- array de { day, open, close } | texto libre
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Solicitudes de alta de club hechas por usuarios. El admin las revisa y aprueba/rechaza.
CREATE TABLE IF NOT EXISTS club_requests (
  id              TEXT PRIMARY KEY,
  requested_by    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  proposed_data   JSONB NOT NULL DEFAULT '{}',     -- redes, contacto, dirección, canchas, horarios
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_club_id TEXT REFERENCES clubs(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Cada torneo se juega (opcionalmente) en un club, con fecha programada del evento.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS club_id    TEXT REFERENCES clubs(id) ON DELETE SET NULL;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS event_date DATE;

CREATE INDEX IF NOT EXISTS idx_clubs_name           ON clubs(name);
CREATE INDEX IF NOT EXISTS idx_tournaments_club     ON tournaments(club_id);
CREATE INDEX IF NOT EXISTS idx_club_requests_status ON club_requests(status);
