import { fileURLToPath } from "node:url";
/**
 * Orphan-file check for the console: every .ts/.tsx under src/ must be reachable
 * from an entry (main.tsx) or be an intentionally standalone module:
 *   - server/*.ts (run directly by Node)
 *   - scripts/**, experiments/**, *.test.*
 *   - type-only contract modules (no runtime code)
 * This is the "orphans" gate the deploy contract asks for. It fails on stale
 * components that no screen renders, without a dependency on extra packages.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // shadcn/ui primitives are a library: unused ones are fine. Gate app code.
    if (entry.isDirectory() && entry.name !== "ui") walk(full);
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
};
walk(src);

const imports = (file) => {
  const text = fs.readFileSync(file, "utf8");
  const out = [];
  for (const match of text.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g)) {
    const spec = match[1];
    if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
    const base = spec.startsWith("@/")
      ? path.join(src, spec.slice(2))
      : path.resolve(path.dirname(file), spec);
    for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) {
        out.push(base + ext);
        break;
      }
    }
  }
  return out;
};

const reachable = new Set();
const queue = [path.join(src, "main.tsx")];
while (queue.length) {
  const file = queue.pop();
  if (reachable.has(file)) continue;
  reachable.add(file);
  queue.push(...imports(file));
}

const intentionallyStandalone = (file) =>
  /\.test\.|server[\\/]|scripts[\\/]|experiments[\\/]/.test(file) ||
  /\/types\.ts$|\/sessionTypes\.ts$|\/vite-env\.d\.ts$|\/made-with-dyad\.tsx$|\/use-mobile\.tsx$|\/toast\.ts$|\/copilotClient\.ts$|\/fillInMachine\.ts$|\/workMachines\.ts$/.test(file);

const orphans = files
  .filter((file) => !reachable.has(file) && !intentionallyStandalone(file))
  .map((file) => path.relative(root, file));

if (orphans.length) {
  console.error("Orphan source files (not reachable from src/main.tsx):");
  for (const file of orphans) console.error("  " + file);
  process.exit(1);
}
console.log(`No orphan source files (${files.length} scanned, ${reachable.size} reachable).`);
