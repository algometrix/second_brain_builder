// Fix sequence-diagram notes/messages whose text wrapped onto a new line.
//
// In a sequenceDiagram, every Note and message must be a single line. When a
// note or message is followed by a line that is not itself a valid statement
// (a wrapped sentence, or a leaked list item like "1. ..."), Mermaid is back
// at statement start and expects a keyword, so it throws e.g.:
//   Parse error on line 13: ...report query finishes ---^ got '1'
// (the "got '1'" case is any continuation line starting with a digit, such as
//  "100ms later ..." or "1. ...").
//
// Fix: fold each continuation line back into the preceding note/message line,
// joined with <br/>. List markers are normalized ("N." / "N)" -> "N:", "-" /
// "*" bullets stripped); plain wrapped prose is kept as-is.
//
// Usage:
//   node scripts/fix-mermaid-sequence-note.js <vault-path>          # Detect only
//   node scripts/fix-mermaid-sequence-note.js <vault-path> --fix    # Detect and fix

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

// Statement keywords that legitimately start a line in a sequenceDiagram.
const KEYWORD_RE = /^(sequenceDiagram|participant|actor|autonumber|activate|deactivate|note|loop|alt|else|opt|par|and|critical|option|break|rect|box|end|title|link|links|create|destroy|accTitle|accDescr)\b/i;
// A message arrow: -> --> ->> -->> -x --x -) --) <<->> <<-->> etc.
const ARROW_RE = /-{1,2}(>>?|x|\))|<{1,2}-{1,2}>>?/;
// A note or message target line we can safely fold continuations into.
const NOTE_OR_MESSAGE_RE = /(^|\s)note\s+(over|left of|right of)\b/i;

function isStatementStart(trimmed) {
  return (
    trimmed === '' ||
    trimmed.startsWith('%%') ||
    KEYWORD_RE.test(trimmed) ||
    ARROW_RE.test(trimmed)
  );
}

function canFoldInto(trimmed) {
  return (
    trimmed.includes(':') &&
    (ARROW_RE.test(trimmed) || NOTE_OR_MESSAGE_RE.test(trimmed))
  );
}

function foldText(trimmed) {
  const numbered = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
  if (numbered) return numbered[1] + ': ' + numbered[2].trim();
  const bullet = trimmed.match(/^[-*]\s+(.*)$/);
  if (bullet) return bullet[1].trim();
  return trimmed;
}

function fixSequenceBlock(inner) {
  const lines = inner.split('\n');
  const out = [];
  let changed = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!isStatementStart(trimmed)) {
      // Find the last non-empty line already emitted.
      let idx = out.length - 1;
      while (idx >= 0 && out[idx].trim() === '') idx--;
      if (idx >= 0 && canFoldInto(out[idx].trim())) {
        out[idx] = out[idx].replace(/\s+$/, '') + '<br/>' + foldText(trimmed);
        changed = true;
        continue;
      }
    }
    out.push(line);
  }

  return { inner: out.join('\n'), changed };
}

function fixMermaidSequenceNotes(content) {
  let changed = false;

  const result = content.replace(/```mermaid\n([\s\S]*?)```/g, (match, inner) => {
    if (!/^\s*sequenceDiagram\b/.test(inner)) return match;

    const fixed = fixSequenceBlock(inner);
    if (fixed.changed) {
      changed = true;
      return '```mermaid\n' + fixed.inner + '```';
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

  const result = fixMermaidSequenceNotes(content);
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
