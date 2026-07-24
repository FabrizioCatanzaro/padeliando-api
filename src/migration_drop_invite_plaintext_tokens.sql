-- Elimina la columna `token` en texto plano de las invitaciones por link.
-- EJECUTAR SOLO después de deployar el código que usa `token_hash`
-- (routes/collaborators.js) y de haber corrido migration_hash_invite_tokens.sql.
ALTER TABLE collaborator_invitations DROP COLUMN IF EXISTS token;
ALTER TABLE ownership_transfers      DROP COLUMN IF EXISTS token;
