// src/seed.ts
// Creates the schema and, if ADMIN_EMAIL / ADMIN_PASSWORD are set, one
// bootstrap admin. There is no built-in demo account and no default password.
//
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='<12+ chars>' npm run seed
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, runQuery, getOne, closeDatabase } from './db/database';

async function seed() {
  await initDatabase();

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Administrator';

  if (!email || !password) {
    console.log('Schema ready. No ADMIN_EMAIL / ADMIN_PASSWORD set, so no admin was created.');
    await closeDatabase();
    return;
  }
  if (password.length < 12) {
    console.error('ADMIN_PASSWORD must be at least 12 characters.');
    await closeDatabase();
    process.exit(1);
  }

  const existing = await getOne('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (existing) {
    console.log(`User ${email} already exists — leaving it untouched.`);
    await closeDatabase();
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await runQuery(
    `INSERT INTO users (id, name, email, password_hash, role, verified)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [uuidv4(), name, email, hash, 'admin', 1]
  );
  console.log(`Admin created: ${email}`);
  console.log('Now clear ADMIN_EMAIL and ADMIN_PASSWORD from the environment.');
  await closeDatabase();
}

seed().catch((err) => { console.error(err); process.exit(1); });
