import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(__dirname, "..");
const docsDistDir = resolve(clientDir, "..", "docs", "dist");
const publicDocsDir = resolve(clientDir, "public", "docs");

if (!existsSync(docsDistDir)) {
  console.warn(`[sync-docs] Skipping: ${docsDistDir} does not exist`);
  process.exit(0);
}

rmSync(publicDocsDir, { recursive: true, force: true });
mkdirSync(publicDocsDir, { recursive: true });
cpSync(docsDistDir, publicDocsDir, { recursive: true });

console.log(`[sync-docs] Copied ${docsDistDir} -> ${publicDocsDir}`);
