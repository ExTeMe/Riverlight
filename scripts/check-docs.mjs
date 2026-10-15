import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function localLinks(markdown) {
  const text = markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[^]*?^\1\s*$/gm, '');
  return [...text.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)]
    .map(match => match[1].replace(/^<|>$/g, ''))
    .filter(link => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(link));
}

export function checkDocs(root, files) {
  const problems = [];
  for (const file of files.filter(file => /\.md$/i.test(file))) {
    for (const link of localLinks(readFileSync(path.join(root, file), 'utf8'))) {
      let target;
      try { target = decodeURIComponent(link.split(/[?#]/)[0]); }
      catch { problems.push(`${file}: invalid link encoding`); continue; }
      const resolved = path.resolve(path.dirname(path.join(root, file)), target);
      const relative = path.relative(root, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(resolved)) problems.push(`${file}: ${link}`);
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const problems = checkDocs(root, files);
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log('Repository-relative Markdown link targets verified. External URLs and anchors require review.');
}
