-- Permitir notificaciones de tipo 'club_request' (avisar a los admins cuando llega
-- una solicitud de alta o edición de club).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('follow', 'invitation', 'join_request', 'admin_message', 'club_request'));
