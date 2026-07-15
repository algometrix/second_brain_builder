// Fix mermaid node labels containing unquoted parentheses or slashes.
// Mermaid misparses special characters in unquoted labels, e.g.
//   A[System (Restart/Scale)]  → parse error
//   A["System (Restart/Scale)"] → correct
//
// Usage:
//   node scripts/fix-mermaid-parens.js <vault-path>          # Detect only
//   node scripts/fix-mermaid-parens.js <vault-path> --fix    # Detect and fix

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

function fixMermaidParens(content) {
  let changed = false;

  const result = content.replace(/```mermaid\n([\s\S]*?)```/g, (match, inner) => {
    let fixed = inner;
    // Quote unquoted labels in [...] containing ( ) or /
    fixed = fixed.replace(/\[([^\]"]*[()\/\\][^\]"]*)\]/g, '["$1"]');
    // Quote unquoted labels in (...) containing nested parens
    fixed = fixed.replace(/\(([^)"]*[()][^)"]*)\)/g, '("$1")');

    if (fixed !== inner) {
      changed = true;
      return '```mermaid\n' + fixed + '```';
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

  const result = fixMermaidParens(content);
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
