-- Grupos de amigos
CREATE TABLE IF NOT EXISTS groups (
  id          TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
 
-- Registro global de jugadores
-- name ya NO es UNIQUE globalmente: dos grupos distintos pueden tener su propio "Pepe"
-- user_id vincula el slot a un usuario registrado (se llena cuando acepta una invitación)
CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
 
-- Qué jugadores pertenecen a qué grupo
CREATE TABLE IF NOT EXISTS group_players (
  group_id   TEXT REFERENCES groups(id)  ON DELETE CASCADE,
  player_id  TEXT REFERENCES players(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, player_id)
);

-- Torneos (una sesión = un torneo)
CREATE TABLE IF NOT EXISTS tournaments (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'free',
  status     TEXT NOT NULL DEFAULT 'active',
  live_match JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS live_match JSONB;
 
-- Parejas fijas (solo modo pairs)
CREATE TABLE IF NOT EXISTS pairs (
  id            TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  p1_id         TEXT NOT NULL REFERENCES players(id),
  p2_id         TEXT NOT NULL REFERENCES players(id)
);
 
-- Partidos
CREATE TABLE IF NOT EXISTS matches (
  id            TEXT    PRIMARY KEY,
  tournament_id TEXT    NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team1_p1      TEXT    NOT NULL REFERENCES players(id),
  team1_p2      TEXT    NOT NULL REFERENCES players(id),
  team2_p1      TEXT    NOT NULL REFERENCES players(id),
  team2_p2      TEXT    NOT NULL REFERENCES players(id),
  score1        INTEGER NOT NULL,
  score2        INTEGER NOT NULL,
  played_at     DATE    NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
 
-- Invitaciones: el dueño del grupo invita a un usuario registrado a reclamar un slot de jugador
CREATE TABLE IF NOT EXISTS player_invitations (
  id                 TEXT PRIMARY KEY,
  player_id          TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  group_id           TEXT NOT NULL REFERENCES groups(id)  ON DELETE CASCADE,
  invited_by         TEXT NOT NULL REFERENCES users(id),
  invited_identifier TEXT NOT NULL,          -- el @username o email que se ingresó
  invited_user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Jugadores por jornada (torneo)
CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id TEXT REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id     TEXT REFERENCES players(id)     ON DELETE CASCADE,
  added_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tournament_id, player_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_tp_tournament         ON tournament_players(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_group     ON tournaments(group_id);
CREATE INDEX IF NOT EXISTS idx_matches_tournament    ON matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_pairs_tournament      ON pairs(tournament_id);
CREATE INDEX IF NOT EXISTS idx_gp_group              ON group_players(group_id);
CREATE INDEX IF NOT EXISTS idx_invitations_user      ON player_invitations(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_player    ON player_invitations(player_id);
