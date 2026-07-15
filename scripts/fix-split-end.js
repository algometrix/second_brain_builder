// Fix mermaid lines corrupted by an old regex that split words like "Send"
// into "S\nend" (putting bare "end" on its own line).
// Rejoins "S\nend ..." back to "Se​nd ..." (with zero-width space).
//
// Usage:
//   node scripts/fix-split-end.js <vault-path>          # Detect only
//   node scripts/fix-split-end.js <vault-path> --fix    # Detect and fix

const fs = require('fs');
const path = require('path');
const { resolveVaultRoot } = require('./vault-root');

const root = resolveVaultRoot();
const fix = process.argv.includes('--fix');
const ZWSP = '​';

function walkDir(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walkDir(full));
    else if (entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

function fixFile(content) {
  let changed = false;

  const result = content.replace(/```mermaid\n([\s\S]*?)```/g, (match, inner) => {
    const lines = inner.split('\n');
    for (let i = 1; i < lines.length; i++) {
      // Line starts with "end " followed by word chars (not a bare "end" closing a subgraph)
      if (/^end\s+\S/.test(lines[i])) {
        const prev = lines[i - 1];
        // Previous line ends with a single uppercase letter or a few chars that form part of a word
        // e.g. '        O -->|"4. S' or '    N->>E: S' or '        B["S'
        if (/[A-Z]\s*$/.test(prev)) {
          // Rejoin: remove "end" from current line, append "e<ZWSP>nd" + rest to previous line
          const rest = lines[i].substring(3); // strip "end"
          lines[i - 1] = prev + 'e' + ZWSP + 'nd' + rest;
          lines.splice(i, 1);
          i--;
          changed = true;
        }
      }
    }
    if (changed) {
      return '```mermaid\n' + lines.join('\n') + '```';
    }
    return match;
  });

  return { content: result, changed };
}

const files = walkDir(root);
let count = 0;

for (const fp of files) {
  const content = fs.readFileSync(fp, 'utf8');
  if (!content.includes('```mermaid')) continue;

  const result = fixFile(content);
  if (result.changed) {
    const rel = path.relative(root, fp);
    console.log((fix ? 'Fixed: ' : 'BROKEN: ') + rel);
    if (fix) {
      fs.writeFileSync(fp, result.content, 'utf8');
    }
    count++;
  }
}

console.log('\nTotal: ' + count);
if (!fix && count > 0) {
  console.log('Run with --fix to apply fixes.');
}
