import { initDatabase, runQuery, getOne } from './db/database';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

async function seed() {
  console.log('🌱 Setting up fresh database...');
  await initDatabase();

  const demoExists = await getOne('SELECT id FROM users WHERE email = $1', ['demo@findthemindia.app']);
  if (!demoExists) {
    const hash = await bcrypt.hash('demo1234', 10);
    await runQuery(
      `INSERT INTO users (id, name, email, password_hash, phone, role, district, state, verified) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [uuidv4(), 'Demo Admin', 'demo@findthemindia.app', hash, '+91-9999999999', 'admin', 'Delhi', 'Delhi', 1]
    );
    console.log('✅ Demo user created: demo@findthemindia.app / demo1234');
  } else {
    console.log('ℹ️  Demo user already exists');
  }

  console.log('\n🎉 Database ready!');
  process.exit(0);
}

seed().catch(console.error);
