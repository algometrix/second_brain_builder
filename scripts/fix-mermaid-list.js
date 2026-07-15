// Fix mermaid labels that trigger "Unsupported markdown: list".
// Mermaid's markdown parser treats "1. text" and "1) text" as ordered lists,
// and "- text" / "* text" as unordered lists inside node/edge labels.
//
// Fixes:
//   - Numbered list: "1. Serialize" / "1) Serialize" → "1: Serialize"
//   - Unordered list: multi-line labels with "- item" lines → <br/>-joined text
//
// Usage:
//   node scripts/fix-mermaid-list.js <vault-path>          # Detect only
//   node scripts/fix-mermaid-list.js <vault-path> --fix    # Detect and fix

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

// Escape numbered list patterns: "1. text" or "1) text" → "1: text"
function fixNumberedList(label) {
  return label
    .replace(/^(\d+)[.)]\s/gm, '$1: ')
    .replace(/(<br\/?>)(\d+)[.)]\s/gi, '$1$2: ');
}

// Convert unordered list items to <br/>-joined text
function fixUnorderedList(label) {
  if (!/(?:^|\n)\s*[-*] /m.test(label)) return label;
  return label
    .split(/\n/)
    .map(l => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter(l => l.length > 0)
    .join('<br/>');
}

function fixLabel(label) {
  return fixNumberedList(fixUnorderedList(label));
}

function fixMermaidList(content) {
  let changed = false;

  const result = content.replace(/```mermaid\n([\s\S]*?)```/g, (match, inner) => {
    let fixed = inner;

    // Fix edge labels: -->|"1. text"| → -->|"1: text"|
    fixed = fixed.replace(/\|"([^"]*?)"\|/g, (_m, label) => {
      const newLabel = fixLabel(label);
      if (newLabel === label) return _m;
      return '|"' + newLabel + '"|';
    });

    // Fix quoted node labels in square brackets: ["..."]
    fixed = fixed.replace(/\["([^\]]*?)"\]/g, (_m, label) => {
      const newLabel = fixLabel(label);
      if (newLabel === label) return _m;
      return '["' + newLabel + '"]';
    });

    // Fix quoted node labels in round brackets: ("...")
    fixed = fixed.replace(/\("([^)]*?)"\)/g, (_m, label) => {
      const newLabel = fixLabel(label);
      if (newLabel === label) return _m;
      return '("' + newLabel + '")';
    });

    // Fix quoted node labels in curly brackets: {"..."}
    fixed = fixed.replace(/\{"([^}]*?)"\}/g, (_m, label) => {
      const newLabel = fixLabel(label);
      if (newLabel === label) return _m;
      return '{"' + newLabel + '"}';
    });

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

  const result = fixMermaidList(content);
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
