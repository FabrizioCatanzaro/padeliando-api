-- Migración: tabla tournament_players
-- Asocia jugadores a jornadas específicas (antes solo estaban vinculados al grupo).

CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id TEXT REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id     TEXT REFERENCES players(id)     ON DELETE CASCADE,
  added_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tournament_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_tp_tournament ON tournament_players(tournament_id);

-- Poblar con datos históricos: para cada torneo, agregar los jugadores
-- que aparecen en sus partidos (los que realmente jugaron).
-- Jugadores que estaban en el grupo pero nunca jugaron quedan fuera.
INSERT INTO tournament_players (tournament_id, player_id)
SELECT DISTINCT m.tournament_id, unnested.player_id
FROM matches m,
  UNNEST(ARRAY[m.team1_p1, m.team1_p2, m.team2_p1, m.team2_p2]) AS unnested(player_id)
ON CONFLICT DO NOTHING;
