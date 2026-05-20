import { initDatabase, runQuery, getOne } from './db/database';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

async function seed() {
  console.log('🌱 Setting up fresh database...');
  await initDatabase();

  // Only create demo admin user — no fake cases
  const demoExists = getOne('SELECT id FROM users WHERE email = ?', ['demo@findthemindia.app']);
  if (!demoExists) {
    const hash = await bcrypt.hash('demo1234', 10);
    runQuery(
      `INSERT INTO users (id, name, email, password_hash, phone, role, district, state, verified) VALUES (?,?,?,?,?,?,?,?,?)`,
      [uuidv4(), 'Demo Admin', 'demo@findthemindia.app', hash, '+91-9999999999', 'admin', 'Delhi', 'Delhi', 1]
    );
    console.log('✅ Demo user created: demo@findthemindia.app / demo1234');
  } else {
    console.log('ℹ️  Demo user already exists');
  }

  console.log('\n🎉 Database ready! (No sample cases — fresh start)');
  console.log('📁 Database file: find_them_india.db');
  process.exit(0);
}

seed().catch(console.error);