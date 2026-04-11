import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const templatePath = path.join(root, "src-tauri", "tauri.release.conf.template.json");
const outputPath = path.join(root, "src-tauri", "tauri.release.conf.json");
const pubkey = process.env.TAURI_UPDATER_PUBKEY;

await mkdir(path.dirname(outputPath), { recursive: true });

if (!pubkey) {
  console.warn("TAURI_UPDATER_PUBKEY not set — building without auto-updater.");
  // Write a minimal config that doesn't enable the updater
  await writeFile(outputPath, JSON.stringify({ bundle: { createUpdaterArtifacts: false } }, null, 2));
  console.log(`Wrote ${path.relative(root, outputPath)} (no updater)`);
  process.exit(0);
}

const template = await readFile(templatePath, "utf8");
const rendered = template.replaceAll("__TAURI_UPDATER_PUBKEY__", pubkey);
await writeFile(outputPath, rendered);

console.log(`Wrote ${path.relative(root, outputPath)}`);
