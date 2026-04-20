#!/usr/bin/env node
// verify-scan-no-egress.mjs — D-65 hard invariant: deep_scan/ must not
// contain any network I/O primitives.
import { exit } from 'process';
import { readdirSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN = ['reqwest::', 'isahc::', 'ureq::', 'TcpStream', 'UdpSocket'];
const SCAN_DIR = join(__dirname, '..', 'src-tauri', 'src', 'deep_scan');

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

for (const file of rsFiles) {
  const content = readFileSync(file, 'utf8');
  for (const pattern of FORBIDDEN) {
    if (content.includes(pattern)) {
      console.error(`[FAIL] verify:scan-no-egress: "${pattern}" found in ${file}`);
      failed = true;
    }
  }
}

if (!failed) console.log('[PASS] verify:scan-no-egress: no network primitives in deep_scan/');
exit(failed ? 1 : 0);
