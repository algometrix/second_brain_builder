// Prepares modes.json (the build input) before every build.
//
// Resolution order:
//   1. modes.config.json exists -> copy its "modesFile" to modes.json
//   2. modes.json already exists -> leave it as-is
//   3. Neither -> copy modes.sample.json to modes.json
//
// modes.json and modes.config.json are gitignored. Keep your own modes in a
// separate file (e.g. modes.personal.json) and point modes.config.json at it.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const target = path.join(root, 'modes.json');
const configPath = path.join(root, 'modes.config.json');
const samplePath = path.join(root, 'modes.sample.json');

function copyValidated(source) {
  const content = fs.readFileSync(source, 'utf8');
  let modes;
  try {
    modes = JSON.parse(content);
  } catch (err) {
    console.error(`${source} is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(modes) || modes.length === 0) {
    console.error(`${source} must be a non-empty JSON array of modes.`);
    process.exit(1);
  }
  fs.writeFileSync(target, content);
}

if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.modesFile) {
    console.error('modes.config.json must contain a "modesFile" property.');
    process.exit(1);
  }
  const source = path.resolve(root, config.modesFile);
  if (!fs.existsSync(source)) {
    console.error(`Modes file from modes.config.json not found: ${source}`);
    process.exit(1);
  }
  copyValidated(source);
  console.log(`modes.json updated from ${config.modesFile}`);
} else if (!fs.existsSync(target)) {
  copyValidated(samplePath);
  console.log('Created modes.json from modes.sample.json. Create modes.config.json to use your own modes file.');
}
