// src/scripts/remove-demo-user.ts
// Deletes the legacy shared demo account. Its password was published in the
// README, so any database that still has the row is still exposed.
//
//   npm run remove-demo-user
import { initDatabase, runQuery, getOne, closeDatabase } from '../db/database';

const DEMO_EMAILS = ['demo@findthemindia.app', 'demo@findthemindia.gov.in'];

async function main() {
  await initDatabase();

  for (const email of DEMO_EMAILS) {
    const user = await getOne('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (!user) {
      console.log(`${email}: not present`);
      continue;
    }
    // Keep the records it touched, just detach the account from them.
    await runQuery('UPDATE missing_persons SET reported_by_user_id = NULL WHERE reported_by_user_id = $1', [user.id]);
    await runQuery('UPDATE case_updates SET author_user_id = NULL WHERE author_user_id = $1', [user.id]);
    await runQuery('UPDATE sightings SET reported_by_user_id = NULL WHERE reported_by_user_id = $1', [user.id]);
    await runQuery('DELETE FROM users WHERE id = $1', [user.id]);
    console.log(`${email}: deleted`);
  }

  await closeDatabase();
}

main().catch((err) => { console.error(err); process.exit(1); });
