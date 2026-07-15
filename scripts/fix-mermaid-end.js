// Fix mermaid "end" reserved keyword issues:
// 1. Strip extra "end" keywords that have no matching block opener
//    (subgraph in flowcharts; par/alt/opt/loop/rect/critical/break/box in sequence diagrams)
// 2. Insert zero-width space into standalone "end" tokens (e.g. node IDs),
//    leaving "end" inside larger words (Vendor, Send, Backend) untouched
// Block-closing "end" lines are preserved.
//
// Usage:
//   node scripts/fix-mermaid-end.js <vault-path>          # Detect only
//   node scripts/fix-mermaid-end.js <vault-path> --fix    # Detect and fix

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

// Block constructs that are closed by a bare "end" line. "subgraph" is the
// flowchart opener; the rest open blocks in sequence diagrams. Continuation
// keywords (and, else, option) neither open nor close a block.
const END_BLOCK_OPENER = /^(subgraph|par|alt|opt|loop|rect|critical|break|box)\b/;

function fixMermaidEnd(content) {
  let changed = false;

  const result = content.replace(/```mermaid\n([\s\S]*?)```/g, (match, inner) => {
    // Strip extra "end" keywords that have no matching block opener
    let depth = 0;
    let stripped = inner.split('\n').filter(line => {
      const trimmed = line.trim();
      if (END_BLOCK_OPENER.test(trimmed)) { depth++; return true; }
      if (trimmed === 'end') { if (depth > 0) { depth--; return true; } return false; }
      return true;
    }).join('\n');

    // Insert ZWSP into standalone "end" tokens (e.g. node IDs) except
    // block-closing "end" lines. Use word boundaries so "end" inside larger
    // words (Vendor, Send, Backend) is left intact -- inserting ZWSP there
    // breaks Mermaid's lexer rather than helping.
    const fixed = stripped.split('\n').map(line => {
      if (line.trim() === 'end') return line;
      return line.replace(/\bend\b/g, 'e' + ZWSP + 'nd');
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

  const result = fixMermaidEnd(content);
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
