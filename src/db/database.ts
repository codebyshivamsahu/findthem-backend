import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'find_them_india.db');

let db: Database;

export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('✅ Loaded existing database from', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('🆕 Created new database');
  }

  createTables();
  return db;
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Auto-save every 5 seconds
setInterval(() => {
  if (db) saveDatabase();
}, 5000);

process.on('exit', () => { if (db) saveDatabase(); });
process.on('SIGINT', () => { if (db) saveDatabase(); process.exit(); });

function createTables() {
  db.run(`
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
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
      reported_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (reported_by_user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sightings (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      reported_by TEXT NOT NULL,
      reported_by_user_id TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      address TEXT NOT NULL,
      description TEXT NOT NULL,
      photo_url TEXT,
      verified_by_ai INTEGER DEFAULT 0,
      confidence REAL,
      status TEXT DEFAULT 'pending',
      reported_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES missing_persons(case_id),
      FOREIGN KEY (reported_by_user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS case_updates (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      author TEXT NOT NULL,
      author_user_id TEXT,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'note',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES missing_persons(case_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      case_id TEXT,
      severity TEXT DEFAULT 'medium',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  console.log('✅ All tables created/verified');
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function runQuery(sql: string, params: any[] = []): void {
  getDb().run(sql, params);
  saveDatabase();
}

export function getAll(sql: string, params: any[] = []): any[] {
  const stmt = getDb().prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

export function getOne(sql: string, params: any[] = []): any | null {
  const rows = getAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}