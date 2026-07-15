// Unified fix script — runs all vault fixers in the correct order.
//
// Usage:
//   node scripts/fix-all.js <vault-path>          # Detect only (all fixers)
//   node scripts/fix-all.js <vault-path> --fix    # Detect and fix (all fixers)
//
// The vault path can also be set via the OBSIDIAN_VAULT environment variable.

const { execSync } = require('child_process');
const path = require('path');
const { resolveVaultRoot } = require('./vault-root');

const root = resolveVaultRoot();
const fix = process.argv.includes('--fix');
const args = fix ? '--fix' : '';

const scripts = [
  'fix-callout-fences.js',
  'fix-currency-dollars.js',
  'fix-mermaid-end.js',
  'fix-mermaid-missing-end.js',
  'fix-split-end.js',
  'fix-mermaid-parens.js',
  'fix-mermaid-quotes.js',
  'fix-mermaid-list.js',
];

for (const script of scripts) {
  const scriptPath = path.join(__dirname, script);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running: ${script} ${args}`);
  console.log('='.repeat(60));
  try {
    const output = execSync(`node "${scriptPath}" "${root}" ${args}`, { encoding: 'utf8' });
    process.stdout.write(output);
  } catch (err) {
    // execSync throws on non-zero exit, but our scripts always exit 0
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log('All fixers complete.');
console.log('='.repeat(60));
