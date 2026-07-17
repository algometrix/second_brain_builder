// Copies the release artifacts into release/ after a release build.
// Run via `npm run build:release`; upload the contents of release/ as the
// GitHub release assets.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'release');

const bundle = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const personal = path.join(root, 'modes.personal.json');
if (fs.existsSync(personal)) {
  const ids = JSON.parse(fs.readFileSync(personal, 'utf8')).map((m) => m.id);
  const sampleIds = JSON.parse(fs.readFileSync(path.join(root, 'modes.sample.json'), 'utf8')).map((m) => m.id);
  const leaked = ids.filter((id) => !sampleIds.includes(id) && bundle.includes(`"${id}"`));
  if (leaked.length > 0) {
    console.error(`Refusing to package: main.js contains personal modes (${leaked.join(', ')}).`);
    console.error('Run "npm run build:release" so the bundle is built from modes.sample.json.');
    process.exit(1);
  }
}

// Stamp the version into main.js and styles.css so every release's assets have
// unique digests. Identical assets across releases share a digest and collect
// one build-provenance attestation per release; Obsidian's community-plugin
// verification rejects assets whose digest has multiple attestations.
const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
const banner = `/* Second Brain Builder ${version} */\n`;

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(path.join(root, 'manifest.json'), path.join(outDir, 'manifest.json'));
for (const name of ['main.js', 'styles.css']) {
  fs.writeFileSync(path.join(outDir, name), banner + fs.readFileSync(path.join(root, name), 'utf8'));
}
console.log(`Release assets written to release/ (main.js, manifest.json, styles.css) for version ${version}`);
