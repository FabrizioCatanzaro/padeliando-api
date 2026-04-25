-- Migración: rol de usuario para dashboard de administración
-- Ejecutar una sola vez en bases de datos existentes

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin'));

-- Convertir manualmente la cuenta admin después de correr esta migración:
--   UPDATE users SET role = 'admin' WHERE email = 'tu-email@ejemplo.com';
