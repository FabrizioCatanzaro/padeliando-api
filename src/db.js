import { neon } from '@neondatabase/serverless';
import "dotenv/config";

let _sql = null;

export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL no está configurado. Revisá tu .env');
  }
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}
