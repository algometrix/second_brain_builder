// Fix unescaped currency dollar signs that Obsidian misinterprets as LaTeX.
// e.g. "$1M portfolio" renders as collapsed LaTeX instead of text.
// Escapes $<digits><letter> and $<digits>,<digits> patterns outside code blocks
// and existing LaTeX expressions.
//
// Usage:
//   node scripts/fix-currency-dollars.js <vault-path>          # Detect only
//   node scripts/fix-currency-dollars.js <vault-path> --fix    # Detect and fix

const fs = require('fs');
const path = require('path');
const { resolveVaultRoot } = require('./vault-root');

const root = resolveVaultRoot();
const fix = process.argv.includes('--fix');

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
  const lines = content.split('\n');
  let inCode = false;
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) { inCode = !inCode; continue; }
    if (inCode) continue;

    const original = lines[i];
    // $<digits><letter> — currency like $1M, $500k, $10B
    lines[i] = lines[i].replace(/(?<!\\)\$(\d+[A-Za-z])/g, '\\$$$1');
    // $<digits>,<digits> — currency like $1,000 $28,800 (not inside LaTeX {,})
    lines[i] = lines[i].replace(/(?<!\\)\$(\d{1,3}(?:,\d{3})+)(?!\})/g, '\\$$$1');
    // $<digits>.<digits> <word> — currency like $1.5 million, $0.03 per
    lines[i] = lines[i].replace(/(?<!\\)\$(\d+\.\d+\s+[a-zA-Z])/g, '\\$$$1');

    if (lines[i] !== original) changed = true;
  }

  return { content: lines.join('\n'), changed };
}

const files = walkDir(root);
let count = 0;

for (const fp of files) {
  const content = fs.readFileSync(fp, 'utf8');
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
