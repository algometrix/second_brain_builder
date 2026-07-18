// Shared vault path resolution for all fix scripts.
// The vault path comes from the first non-flag CLI argument, then the
// OBSIDIAN_VAULT environment variable, then an OBSIDIAN_VAULT entry in a
// .env file at the repo root (KEY=VALUE lines, # comments allowed).

const fs = require('fs');
const path = require('path');

function readVaultFromDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return undefined;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*OBSIDIAN_VAULT\s*=\s*(.+?)\s*$/);
    if (match && !line.trim().startsWith('#')) {
      return match[1].replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

function resolveVaultRoot() {
  const arg = process.argv.slice(2).find(a => !a.startsWith('--'));
  const root = arg || process.env.OBSIDIAN_VAULT || readVaultFromDotEnv();

  if (!root) {
    const script = path.basename(process.argv[1] || 'fix-script.js');
    console.error(`Usage: node scripts/${script} <vault-path> [--fix]`);
    console.error('Or set OBSIDIAN_VAULT in the environment or in a .env file at the repo root.');
    process.exit(1);
  }

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`Vault path is not a directory: ${root}`);
    process.exit(1);
  }

  return path.resolve(root);
}

module.exports = { resolveVaultRoot };
