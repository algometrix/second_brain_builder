// Re-insert missing "end" keywords in mermaid blocks. An earlier version of
// fix-mermaid-end.js only recognized flowchart "subgraph" as a block opener,
// so it stripped legitimate "end" lines that closed sequence diagram blocks
// (par/alt/opt/loop/rect/critical/break/box). This script restores them.
//
// Placement heuristic: a block closes where indentation returns to the
// opener's level (continuation keywords like else/and/option stay inside).
// Blocks whose content is not indented deeper than the opener close at the
// end of the diagram.
//
// Also ensures the closing ``` sits on its own line — some blocks ended with
// "end```" (no newline), which prevents markdown from closing the fence.
//
// Usage:
//   node scripts/fix-mermaid-missing-end.js <vault-path>          # Detect only
//   node scripts/fix-mermaid-missing-end.js <vault-path> --fix    # Detect and fix

const fs = require('fs');
const path = require('path');
const { resolveVaultRoot } = require('./vault-root');

const root = resolveVaultRoot();
const fix = process.argv.includes('--fix');

const SEQUENCE_OPENER = /^(par|alt|opt|loop|rect|critical|break|box)\b/;
const FLOWCHART_OPENER = /^subgraph\b/;
const CONTINUATION = /^(else|and|option)\b/;

function walkDir(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walkDir(full));
    else if (entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

function diagramOpener(lines) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (/^sequenceDiagram\b/.test(trimmed)) return SEQUENCE_OPENER;
    if (/^(flowchart|graph)\b/.test(trimmed)) return FLOWCHART_OPENER;
    return null; // other diagram types don't use bare "end"
  }
  return null;
}

function repairBlock(inner, opener) {
  const lines = inner.split('\n');
  const out = [];
  // stack entries: { indent, indented: null|true|false }
  // indented tracks whether the block's content is indented deeper than the
  // opener (null until the first content line is seen)
  const stack = [];

  const closeTop = () => {
    const top = stack.pop();
    out.push(' '.repeat(top.indent) + 'end');
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { out.push(line); continue; }
    const indent = line.length - line.trimStart().length;

    if (trimmed === 'end') {
      if (stack.length > 0) stack.pop();
      out.push(line);
      continue;
    }

    if (CONTINUATION.test(trimmed) && stack.length > 0) {
      out.push(line);
      continue;
    }

    // Dedent closes indented-style blocks
    while (stack.length > 0 && stack[stack.length - 1].indented === true
        && indent <= stack[stack.length - 1].indent) {
      closeTop();
    }

    if (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.indented === null) top.indented = indent > top.indent;
    }

    if (opener.test(trimmed)) {
      stack.push({ indent, indented: null });
    }
    out.push(line);
  }

  // Close anything still open at the end of the diagram (innermost first),
  // inserting before trailing blank lines so the closing ``` stays on its own line
  const needClose = stack.length > 0;
  const trailing = [];
  while (out.length > 0 && out[out.length - 1].trim() === '') trailing.push(out.pop());
  while (stack.length > 0) closeTop();
  if (needClose && trailing.length === 0) trailing.push('');
  out.push(...trailing.reverse());

  return out.join('\n');
}

function fixMissingEnd(content) {
  let changed = false;

  const result = content.replace(/```mermaid\n([\s\S]*?)```/g, (match, inner) => {
    const opener = diagramOpener(inner.split('\n'));
    let fixed = opener ? repairBlock(inner, opener) : inner;
    // Closing fence must be on its own line
    if (!fixed.endsWith('\n')) fixed += '\n';

    const rebuilt = '```mermaid\n' + fixed + '```';
    if (rebuilt !== match) {
      changed = true;
      return rebuilt;
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

  const result = fixMissingEnd(content);
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
