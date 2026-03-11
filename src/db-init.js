import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Pool } from '@neondatabase/serverless';
 
const __dirname = dirname(fileURLToPath(import.meta.url));
const schema    = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
 
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 
try {
  await pool.query(schema);
  console.log('✅ Schema aplicado correctamente.');
} finally {
  await pool.end();
}