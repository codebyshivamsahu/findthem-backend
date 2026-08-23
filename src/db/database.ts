// src/db/database.ts
import { Pool } from 'pg';
import { config } from '../config';

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.isProduction ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  // A pooled client died in the background — log it, don't crash the process.
  console.error('Unexpected PostgreSQL client error:', err.message);
});

export async function initDatabase(): Promise<void> {
  await createTables();
  await createIndexes();
  console.log('PostgreSQL connected, schema ready');
}

async function createTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'volunteer',
      district TEXT,
      state TEXT,
      verified INTEGER DEFAULT 0,
      avatar TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS missing_persons (
      id TEXT PRIMARY KEY,
      case_id TEXT UNIQUE NOT NULL,
      fir_number TEXT,
      name TEXT NOT NULL,
      age INTEGER NOT NULL,
      gender TEXT NOT NULL,
      last_seen_date TEXT NOT NULL,
      last_seen_location TEXT NOT NULL,
      last_seen_address TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      description TEXT NOT NULL,
      distinguishing_marks TEXT,
      photos TEXT DEFAULT '[]',
      status TEXT DEFAULT 'open',
      reported_by TEXT,
      reported_by_user_id TEXT,
      assigned_officer TEXT,
      district TEXT NOT NULL,
      state TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      contact_email TEXT,
      match_confidence REAL,
      age_progressed TEXT,
      reported_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sightings (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      reported_by TEXT NOT NULL,
      reported_by_user_id TEXT,
      latitude REAL,
      longitude REAL,
      address TEXT NOT NULL,
      description TEXT NOT NULL,
      photo_url TEXT,
      verified_by_ai INTEGER DEFAULT 0,
      confidence REAL,
      status TEXT DEFAULT 'pending',
      reviewed_by_user_id TEXT,
      reviewed_at TIMESTAMPTZ,
      reported_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS case_updates (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      author TEXT NOT NULL,
      author_user_id TEXT,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'note',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      case_id TEXT,
      severity TEXT DEFAULT 'medium',
      is_active INTEGER DEFAULT 1,
      created_by_user_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Columns added after the first release — safe to run repeatedly.
  await pool.query(`ALTER TABLE sightings ADD COLUMN IF NOT EXISTS reviewed_by_user_id TEXT`);
  await pool.query(`ALTER TABLE sightings ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS created_by_user_id TEXT`);
}

async function createIndexes(): Promise<void> {
  const statements = [
    `CREATE INDEX IF NOT EXISTS idx_cases_status ON missing_persons (status)`,
    `CREATE INDEX IF NOT EXISTS idx_cases_state ON missing_persons (state)`,
    `CREATE INDEX IF NOT EXISTS idx_cases_reported_at ON missing_persons (reported_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_cases_reporter ON missing_persons (reported_by_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sightings_case ON sightings (case_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sightings_status ON sightings (status)`,
    `CREATE INDEX IF NOT EXISTS idx_updates_case ON case_updates (case_id)`,
    `CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts (is_active, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email))`,
  ];
  for (const sql of statements) await pool.query(sql);
}

export async function ping(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

/** Run a statement that returns no rows (INSERT / UPDATE / DELETE). */
export async function runQuery(sql: string, params: any[] = []): Promise<void> {
  await pool.query(sql, params);
}

export async function getAll(sql: string, params: any[] = []): Promise<any[]> {
  const result = await pool.query(sql, params);
  return result.rows;
}

export async function getOne(sql: string, params: any[] = []): Promise<any | null> {
  const rows = await getAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/** Run several statements inside one transaction. */
export async function transaction<T>(
  fn: (q: (sql: string, params?: any[]) => Promise<any>) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn((sql, params = []) => client.query(sql, params));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
