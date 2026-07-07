-- Solicitudes de EDICIÓN de un club existente.
-- club_id NULL = solicitud de alta (club nuevo). club_id seteado = solicitud de cambios a ese club.
ALTER TABLE club_requests ADD COLUMN IF NOT EXISTS club_id TEXT REFERENCES clubs(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_club_requests_club ON club_requests(club_id);
-- Snapshot de los datos del club al crear la solicitud (para el diff "antes → después").
ALTER TABLE club_requests ADD COLUMN IF NOT EXISTS previous_data JSONB;
