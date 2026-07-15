// Fix callout code fences in Obsidian notes.
// Finds code blocks inside callouts (> [!...]) where the closing ```
// or content lines are missing the required "> " prefix.
//
// Usage:
//   node scripts/fix-callout-fences.js <vault-path>          # Detect only
//   node scripts/fix-callout-fences.js <vault-path> --fix    # Detect and fix

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
  let inCallout = false;
  let inCalloutCode = false;
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inCalloutCode) {
      if (/^>\s*```\s*$/.test(line)) {
        // Properly prefixed closing fence
        inCalloutCode = false;
      } else if (/^```\s*$/.test(line)) {
        // Bare closing fence missing "> " prefix
        lines[i] = '> ```';
        inCalloutCode = false;
        changed = true;
      } else if (!/^>/.test(line) && line.trim() !== '') {
        // Content line missing "> " prefix
        lines[i] = '> ' + line;
        changed = true;
      }
      continue;
    }

    if (/^>\s*\[!/.test(line)) {
      inCallout = true;
      inCalloutCode = false;
    } else if (inCallout && /^>\s*```/.test(line) && !/^>\s*```\s*$/.test(line)) {
      // Opening fence with language tag
      inCalloutCode = true;
    } else if (inCallout && /^>\s*```\s*$/.test(line)) {
      // Opening fence without language tag
      inCalloutCode = true;
    } else if (inCallout && !/^>/.test(line) && line.trim() !== '') {
      inCallout = false;
    }
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
