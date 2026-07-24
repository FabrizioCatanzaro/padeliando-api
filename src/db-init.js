import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Pool } from '@neondatabase/serverless';
 
const __dirname = dirname(fileURLToPath(import.meta.url));
const schema    = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
 
// Las migraciones necesitan permisos DDL: usar el rol owner (DATABASE_URL_ADMIN).
// DATABASE_URL apunta al rol de app de minimo privilegio (solo DML) en produccion.
const pool = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL });
 
try {
  await pool.query(schema);
  console.log('✅ Schema aplicado correctamente.');
} finally {
  await pool.end();
}