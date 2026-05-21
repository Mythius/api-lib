import { readdirSync, readFileSync, statSync } from "fs";
import { join, extname } from "path";

const SKIP_DIRS = new Set(["node_modules", ".git", "prisma/generated", "tools/generated", "historical"]);
const SKIP_EXTS = new Set([".json", ".csv", ".lock", ".md", ".xlsx", ".wasm", ".png", ".patch", ".mjs"]);
const SKIP_FILES = new Set(["bun.lock", ".DS_Store", ".env"]);

function walk(dir: string, root: string): { file: string; lines: number }[] {
  const results: { file: string; lines: number }[] = [];

  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = abs.slice(root.length + 1);
    const stat = statSync(abs);

    if (stat.isDirectory()) {
      if ([...SKIP_DIRS].some((d) => rel === d || rel.startsWith(d + "/"))) continue;
      results.push(...walk(abs, root));
    } else {
      if (SKIP_FILES.has(entry)) continue;
      if (SKIP_EXTS.has(extname(entry))) continue;
      const lines = readFileSync(abs, "utf8").split("\n").length;
      results.push({ file: rel, lines });
    }
  }

  return results;
}

const root = join(import.meta.dir, "..");
const files = walk(root, root).sort((a, b) => b.lines - a.lines);

console.log("\nLines of code by file:\n");
for (const { file, lines } of files) {
  console.log(`${String(lines).padStart(6)}  ${file}`);
}

const total = files.reduce((sum, f) => sum + f.lines, 0);
console.log(`\n${"─".repeat(40)}`);
console.log(`${String(total).padStart(6)}  TOTAL (${files.length} files)`);
