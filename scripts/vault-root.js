// Shared vault path resolution for all fix scripts.
// The vault path comes from the first non-flag CLI argument, or from the
// OBSIDIAN_VAULT environment variable if no argument is given.

const fs = require('fs');
const path = require('path');

function resolveVaultRoot() {
  const arg = process.argv.slice(2).find(a => !a.startsWith('--'));
  const root = arg || process.env.OBSIDIAN_VAULT;

  if (!root) {
    const script = path.basename(process.argv[1] || 'fix-script.js');
    console.error(`Usage: node scripts/${script} <vault-path> [--fix]`);
    console.error('Or set the OBSIDIAN_VAULT environment variable to your vault path.');
    process.exit(1);
  }

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`Vault path is not a directory: ${root}`);
    process.exit(1);
  }

  return path.resolve(root);
}

module.exports = { resolveVaultRoot };
