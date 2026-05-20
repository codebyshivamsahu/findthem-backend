import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export async function initDatabase(): Promise<void> {
  await createTables();
  console.log('✅ PostgreSQL connected & tables ready');
}

async function createTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone TEXT,
      role TEXT DEFAULT 'volunteer',
      district TEXT,
      state TEXT,
      verified INTEGER DEFAULT 0,
      avatar TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
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
      reported_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
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
      reported_at TIMESTAMP DEFAULT NOW()
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
      created_at TIMESTAMP DEFAULT NOW()
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
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

// Run a query that doesn't return rows (INSERT, UPDATE, DELETE)
export async function runQuery(sql: string, params: any[] = []): Promise<void> {
  // Convert ? placeholders to $1, $2, ... for PostgreSQL
  const pgSql = convertPlaceholders(sql);
  await pool.query(pgSql, params);
}

// Get all rows
export async function getAll(sql: string, params: any[] = []): Promise<any[]> {
  const pgSql = convertPlaceholders(sql);
  const result = await pool.query(pgSql, params);
  return result.rows;
}

// Get one row
export async function getOne(sql: string, params: any[] = []): Promise<any | null> {
  const rows = await getAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Convert SQLite ? placeholders to PostgreSQL $1, $2, ...
function convertPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Fix SQLite datetime() calls to PostgreSQL NOW()
export function fixDatetime(sql: string): string {
  return sql.replace(/datetime\('now'\)/g, 'NOW()');
}

export default pool;
