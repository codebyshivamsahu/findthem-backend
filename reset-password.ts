import bcrypt from "bcryptjs";
import { runQuery, closeDatabase } from "./src/db/database";

const email = "codebyshivamsahu@gmail.com";
const password = process.env.NEW_PASSWORD;

async function main() {
  if (!password || password.length < 8) {
    console.error("Set NEW_PASSWORD (8+ chars) first");
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  await runQuery("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE LOWER(email) = LOWER($2)", [hash, email]);
  console.log("Password updated for " + email);
  await closeDatabase();
}
main().catch(e => { console.error(e); process.exit(1); });
