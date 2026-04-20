#!/usr/bin/env node
// verify-scan-no-write.mjs — D-65 hard invariant: deep_scan/ scanners must
// not write outside ~/.blade/identity/. profile.rs and mod.rs (save_results)
// are the only allowed write sites.
import { exit } from 'process';
import { readdirSync, readFileSync } from 'fs';
import { join, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WRITE_PATTERNS = ['fs::write', 'File::create', 'OpenOptions', 'create_dir_all', 'remove_file'];
const SCAN_DIR = join(__dirname, '..', 'src-tauri', 'src', 'deep_scan');
// Files allowed to contain write operations (profile.rs writes overlay, mod.rs writes scan_results.json)
const ALLOWED_FILES = new Set(['profile.rs', 'mod.rs']);

function collectRsFiles(dir) {
  let files = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files = files.concat(collectRsFiles(full));
      else if (entry.isFile() && extname(entry.name) === '.rs') files.push(full);
    }
  } catch (_) {}
  return files;
}

const rsFiles = collectRsFiles(SCAN_DIR);
let failed = false;

/**
 * Strip #[cfg(test)] mod blocks from Rust source before scanning.
 * Test code is allowed to use fs::write / create_dir_all to create
 * temp fixtures — only production scanner code is gated.
 * Strategy: drop all content from the first '#[cfg(test)]' onward.
 */
function stripTestBlocks(content) {
  const cfgTestIdx = content.indexOf('#[cfg(test)]');
  if (cfgTestIdx === -1) return content;
  return content.slice(0, cfgTestIdx);
}

for (const file of rsFiles) {
  if (ALLOWED_FILES.has(basename(file))) continue;
  const raw = readFileSync(file, 'utf8');
  const content = stripTestBlocks(raw);
  for (const pattern of WRITE_PATTERNS) {
    if (content.includes(pattern)) {
      console.error(`[FAIL] verify:scan-no-write: "${pattern}" in scanner file ${file} (not allowed here)`);
      failed = true;
    }
  }
}

if (!failed) console.log('[PASS] verify:scan-no-write: no forbidden writes in scanner files');
exit(failed ? 1 : 0);
