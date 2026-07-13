import { SQL } from "bun";

const args = Bun.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const jsonMode = args.includes("--json");

if (!file) {
  console.error("Usage: bun run-sql.ts <file.sql> [--json]");
  process.exit(1);
}

const sqlFile = Bun.file(file);
if (!(await sqlFile.exists())) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

const query = await sqlFile.text();
const db = new SQL(process.env.DATABASE_URL!);
const rows = await db.unsafe(query);

console.error(`${rows.length} row(s)`);
if (jsonMode) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.table(rows);
}
