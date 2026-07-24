import 'dotenv/config';
import { readFileSync } from 'fs';
import { Pool } from '@neondatabase/serverless';

// Aplica un archivo .sql suelto contra la base (para migraciones que no van en schema.sql).
// Uso: npm run db:migrate -- src/migration_xxx.sql
const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run db:migrate -- <ruta-al-archivo.sql>');
  process.exit(1);
}

const sql  = readFileSync(file, 'utf8');
// Las migraciones necesitan permisos DDL: usar el rol owner (DATABASE_URL_ADMIN).
// DATABASE_URL apunta al rol de app de minimo privilegio (solo DML) en produccion.
const pool = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL });

try {
  await pool.query(sql);
  console.log(`✅ Migración aplicada: ${file}`);
} catch (e) {
  console.error(`❌ Error aplicando ${file}:`, e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
