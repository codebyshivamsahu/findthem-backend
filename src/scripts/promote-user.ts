// src/scripts/promote-user.ts
// Roles are never accepted from the signup form. This is the supported way to
// grant ngo / police / admin.
//
//   npm run promote-user -- someone@example.com police
import { initDatabase, runQuery, getOne, closeDatabase } from '../db/database';

const VALID_ROLES = ['volunteer', 'ngo', 'police', 'admin'];

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !role) {
    console.error('Usage: npm run promote-user -- <email> <role>');
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid role. One of: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  await initDatabase();
  const user = await getOne('SELECT id, name, email, role FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (!user) {
    console.error(`No user with email ${email}`);
    await closeDatabase();
    process.exit(1);
  }

  await runQuery('UPDATE users SET role = $1, verified = 1, updated_at = NOW() WHERE id = $2', [role, user.id]);
  console.log(`${user.name} <${user.email}>: ${user.role} -> ${role}`);
  await closeDatabase();
}

main().catch((err) => { console.error(err); process.exit(1); });
