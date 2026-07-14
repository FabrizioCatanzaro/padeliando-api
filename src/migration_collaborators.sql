-- Co-organizadores de una categoría + transferencia de propiedad.
-- Aplicar en prod:  npm run db:migrate -- src/migration_collaborators.sql

-- Co-organizadores: pueden gestionar las jornadas de la categoría (igual que el dueño),
-- pero NO editar/borrar la categoría, transferir ni gestionar co-organizadores.
CREATE TABLE IF NOT EXISTS group_collaborators (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  added_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  added_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

-- Invitaciones a co-organizar (por @username/email → invited_user_id, o por link → token).
CREATE TABLE IF NOT EXISTS collaborator_invitations (
  id                 TEXT PRIMARY KEY,
  group_id           TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  invited_by         TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  invited_identifier TEXT,
  invited_user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  token              TEXT UNIQUE,
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected','cancelled')),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Transferencias de propiedad de una categoría (irreversibles, requieren aceptación).
CREATE TABLE IF NOT EXISTS ownership_transfers (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user_id  TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  to_user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT UNIQUE,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected','cancelled')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_collab_user     ON group_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_group_collab_group    ON group_collaborators(group_id);
CREATE INDEX IF NOT EXISTS idx_collab_inv_user       ON collaborator_invitations(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_collab_inv_group      ON collaborator_invitations(group_id);
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_group ON ownership_transfers(group_id);

-- Ampliar el CHECK de notifications.type con los tipos nuevos.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('follow','invitation','join_request','admin_message','club_request',
                  'collab_invite','ownership_transfer'));
