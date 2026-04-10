import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const templatePath = path.join(root, "src-tauri", "tauri.release.conf.template.json");
const outputPath = path.join(root, "src-tauri", "tauri.release.conf.json");
const pubkey = process.env.TAURI_UPDATER_PUBKEY;

if (!pubkey) {
  console.error("TAURI_UPDATER_PUBKEY is required to generate the release updater config.");
  process.exit(1);
}

const template = await readFile(templatePath, "utf8");
const rendered = template.replaceAll("__TAURI_UPDATER_PUBKEY__", pubkey);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, rendered);

console.log(`Wrote ${path.relative(root, outputPath)}`);
