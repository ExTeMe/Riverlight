import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const privatePath = /(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\/(?:Users|home)\/[^\s/]+)/;
const binaryPersonalPath = /(?:[A-Za-z]:[\\/]Users[\\/][A-Za-z0-9._ -]{1,64}(?:[\\/]|(?=[\s\0]|$))|\/(?:Users|home)\/[A-Za-z0-9._-]+\/)/;

export function containsLocalPath(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!buffer.includes(0)) return privatePath.test(buffer.toString('utf8'));
  // Random mesh/image/audio bytes can resemble a drive prefix; binary checks
  // require a recognizable personal-directory path, with native review for
  // compressed metadata rather than changing valid assets on a false match.
  return binaryPersonalPath.test(buffer.toString('utf8')) || binaryPersonalPath.test(buffer.toString('utf16le'));
}

export function checkRepository(root) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean);
  const violations = [];
  for (const file of files) {
    if (containsLocalPath(readFileSync(path.join(root, file)))) violations.push(file);
  }
  return { files: files.length, violations };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = checkRepository(root);
  if (result.violations.length) {
    console.error('Local absolute paths detected in tracked files (values intentionally omitted):');
    for (const file of result.violations) console.error(`- ${file}`);
    process.exitCode = 1;
  } else {
    console.log(`Privacy path check passed: ${result.files} tracked files. Compressed binary metadata and credentials require separate review.`);
  }
}
