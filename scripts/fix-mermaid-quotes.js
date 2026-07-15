// Fix mermaid labels with nested double quotes that break parsing.
// Inner quotes inside an already-quoted label cause premature termination:
//   A["0x400000 ("non-PIE) or random (PIE")"]  → parse error
//   A["0x400000 (non-PIE) or random (PIE)"]     → correct
//
// Strips inner double quotes from within quoted mermaid labels by finding
// patterns like ["...("word)..."] where quotes appear inside parentheses.
//
// Usage:
//   node scripts/fix-mermaid-quotes.js <vault-path>          # Detect only
//   node scripts/fix-mermaid-quotes.js <vault-path> --fix    # Detect and fix

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

function fixMermaidQuotes(content) {
  let changed = false;

  const result = content.replace(/```mermaid\n([\s\S]*?)```/g, (match, inner) => {
    let fixed = inner;

    // Process each line individually to find quoted labels with inner quotes.
    // A quoted label looks like: ["content"] or ("content") or {"content"} or |"content"|
    // If "content" itself has double quotes, they break parsing.
    fixed = fixed.split('\n').map(line => {
      // For each quoted-label pattern, find and strip inner quotes
      return line
        // Square bracket labels: ["..."]
        .replace(/\["((?:[^"]|"(?!\]))+)"\]/g, (m, label) => {
          if (!label.includes('"')) return m;
          return '["' + label.replace(/"/g, "") + '"]';
        })
        // Round bracket labels: ("...")
        .replace(/\("((?:[^"]|"(?!\)))+)"\)/g, (m, label) => {
          if (!label.includes('"')) return m;
          return '("' + label.replace(/"/g, "") + '")';
        })
        // Curly bracket labels: {"..."}
        .replace(/\{"((?:[^"]|"(?!\}))+)"\}/g, (m, label) => {
          if (!label.includes('"')) return m;
          return '{"' + label.replace(/"/g, "") + '"}';
        })
        // Edge labels: |"..."|
        .replace(/\|"((?:[^"]|"(?!\|))+)"\|/g, (m, label) => {
          if (!label.includes('"')) return m;
          return '|"' + label.replace(/"/g, "") + '"|';
        });
    }).join('\n');

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

  const result = fixMermaidQuotes(content);
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
