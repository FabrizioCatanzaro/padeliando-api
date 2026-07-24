-- Hashea los tokens de invitación por link (co-organizador y transferencia de propiedad).
-- Antes se guardaban en texto plano en `token`; ahora se guarda solo el hash SHA-256
-- en `token_hash`, igual que refresh_tokens / password_resets / email_verifications.
--
-- Migración ADITIVA: no elimina la columna `token` para no romper el código en producción
-- mientras se deploya. El backfill hashea los tokens vivos, así los links ya emitidos siguen
-- funcionando. La columna `token` se elimina luego con migration_drop_invite_plaintext_tokens.sql.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- collaborator_invitations
ALTER TABLE collaborator_invitations ADD COLUMN IF NOT EXISTS token_hash TEXT;
UPDATE collaborator_invitations
  SET token_hash = encode(digest(token, 'sha256'), 'hex')
  WHERE token IS NOT NULL AND token_hash IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS collaborator_invitations_token_hash_key
  ON collaborator_invitations(token_hash);

-- ownership_transfers
ALTER TABLE ownership_transfers ADD COLUMN IF NOT EXISTS token_hash TEXT;
UPDATE ownership_transfers
  SET token_hash = encode(digest(token, 'sha256'), 'hex')
  WHERE token IS NOT NULL AND token_hash IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ownership_transfers_token_hash_key
  ON ownership_transfers(token_hash);
