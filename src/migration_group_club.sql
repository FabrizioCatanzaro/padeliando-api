-- Categorías (grupos) con club por defecto, heredable a sus torneos.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS club_id TEXT REFERENCES clubs(id) ON DELETE SET NULL;

-- Referencia a una solicitud de club pendiente: al aprobarse, se backfillea club_id.
ALTER TABLE groups      ADD COLUMN IF NOT EXISTS pending_club_request_id TEXT REFERENCES club_requests(id) ON DELETE SET NULL;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS pending_club_request_id TEXT REFERENCES club_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_groups_club              ON groups(club_id);
CREATE INDEX IF NOT EXISTS idx_groups_pending_club      ON groups(pending_club_request_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_pending_club ON tournaments(pending_club_request_id);
