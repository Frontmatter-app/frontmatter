#!/usr/bin/env node
/**
 * Generates the TypeScript IPC contract from the Rust command definitions.
 *
 * Rust is the single source of truth. This script parses every
 * `#[tauri::command]` function, keeps the ones actually registered in
 * `generate_handler!`, and emits `src/ipc/generated.ts`.
 *
 *   npm run ipc:gen        rewrite the contract
 *   npm run test           fails if the checked-in contract has drifted
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repository root. When this module is imported by a test runner that rewrites
 * module URLs, `import.meta.url` is not a file URL, so fall back to the working
 * directory — the test runner is configured with the repo root.
 */
function repoRoot() {
  try {
    return join(fileURLToPath(new URL('.', import.meta.url)), '..');
  } catch {
    return process.cwd();
  }
}

const ROOT = repoRoot();
const RUST_SRC = join(ROOT, 'src-tauri', 'src');
const MAIN_RS = join(RUST_SRC, 'main.rs');
export const OUTPUT = join(ROOT, 'src', 'ipc', 'generated.ts');

/** Parameters Tauri injects; they are never sent from JavaScript. */
const INJECTED = [
  /^tauri::AppHandle$/,
  /^AppHandle$/,
  /^tauri::Window$/,
  /^Window$/,
  /^tauri::WebviewWindow$/,
  /^WebviewWindow$/,
  /^tauri::State<.*>$/,
  /^State<.*>$/,
];

function rustFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...rustFiles(path));
    else if (entry.endsWith('.rs')) out.push(path);
  }
  return out.sort();
}

/** Splits on commas that are not nested inside <>, (), or []. */
function splitTopLevel(input) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '<' || ch === '(' || ch === '[') depth++;
    else if (ch === '>' || ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Reads from `start` to the matching close paren. */
function balanced(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return { body: source.slice(start + 1, i), end: i };
    }
  }
  return null;
}

const snakeToCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Maps a Rust type to a TypeScript type. Unknown structs become `unknown`. */
function rustTypeToTs(raw) {
  let type = raw.trim().replace(/^&/, '').replace(/^'[a-z]+\s+/, '');

  const option = /^Option<(.+)>$/s.exec(type);
  if (option) return { ts: rustTypeToTs(option[1]).ts + ' | null', optional: true };

  const vec = /^(?:Vec|VecDeque)<(.+)>$/s.exec(type);
  if (vec) {
    const inner = rustTypeToTs(vec[1]);
    return { ts: `${inner.ts.includes('|') ? `(${inner.ts})` : inner.ts}[]`, optional: false };
  }

  const map = /^(?:HashMap|BTreeMap)<(.+)>$/s.exec(type);
  if (map) {
    const [k, v] = splitTopLevel(map[1]);
    const key = rustTypeToTs(k).ts === 'number' ? 'number' : 'string';
    return { ts: `Record<${key}, ${rustTypeToTs(v).ts}>`, optional: false };
  }

  if (/^\(.*\)$/s.test(type)) {
    const inner = splitTopLevel(type.slice(1, -1));
    if (inner.length === 0) return { ts: 'null', optional: false };
    return { ts: `[${inner.map((t) => rustTypeToTs(t).ts).join(', ')}]`, optional: false };
  }

  if (/^(String|str|PathBuf|Path)$/.test(type)) return { ts: 'string', optional: false };
  if (/^bool$/.test(type)) return { ts: 'boolean', optional: false };
  if (/^([iu](8|16|32|64|128|size)|f32|f64)$/.test(type)) return { ts: 'number', optional: false };
  if (/^(serde_json::)?Value$/.test(type)) return { ts: 'unknown', optional: false };

  // A user-defined type: emit its name if we parsed a serialisable definition
  // for it, so results are real interfaces rather than `unknown`.
  const bare = type.split('::').pop();
  if (STRUCTS.has(bare)) {
    USED_STRUCTS.add(bare);
    return { ts: bare, optional: false };
  }

  return { ts: 'unknown', optional: false };
}

/** Serialisable Rust structs, keyed by name. Populated by `parseStructs`. */
const STRUCTS = new Map();
/** Structs actually reachable from a command signature. */
const USED_STRUCTS = new Set();

const RENAME_RULES = {
  camelCase: (s) => snakeToCamel(s),
  snake_case: (s) => s,
  PascalCase: (s) => snakeToCamel(s).replace(/^./, (c) => c.toUpperCase()),
  SCREAMING_SNAKE_CASE: (s) => s.toUpperCase(),
  kebabCase: (s) => s.replace(/_/g, '-'),
  'kebab-case': (s) => s.replace(/_/g, '-'),
};

/**
 * Collects `struct` definitions that derive `Serialize`, honouring
 * `#[serde(rename_all = ...)]`, `rename`, and `skip_serializing_if`.
 */
function parseStructs() {
  for (const file of rustFiles(RUST_SRC)) {
    const source = readFileSync(file, 'utf8');
    const re = /((?:#\[[^\]]*\]\s*)+)pub struct\s+([A-Za-z0-9_]+)\s*\{/g;
    let match;

    while ((match = re.exec(source)) !== null) {
      const [, attrs, name] = match;
      if (!/derive\([^)]*\bSerialize\b/.test(attrs)) continue;

      const open = source.indexOf('{', match.index + attrs.length);
      let depth = 0;
      let end = open;
      for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }

      const renameAll = /rename_all\s*=\s*"([^"]+)"/.exec(attrs)?.[1];
      const rename = RENAME_RULES[renameAll] ?? ((s) => s);
      // Comments go before the split, not after: a comma inside a doc comment
      // would otherwise be read as a field separator and split the field it
      // documents away from its own declaration, dropping it from the bindings.
      const body = source.slice(open + 1, end).replace(/^[ \t]*\/\/.*$/gm, '');
      const fields = [];

      // Split fields on top-level commas so generics survive.
      let fieldAttrs = '';
      for (const chunk of splitTopLevel(body)) {
        const text = chunk.trim();
        if (!text) continue;

        const attrMatches = text.match(/#\[[^\]]*\]/g) || [];
        fieldAttrs = attrMatches.join(' ');
        // Doc comments sit between the attributes and `pub`, so they have to go
        // before the declaration can be matched — otherwise a documented field
        // is silently dropped from the bindings.
        const declaration = text
          .replace(/#\[[^\]]*\]/g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '')
          .trim();
        const field = /^pub\s+([a-z0-9_]+)\s*:\s*([\s\S]+)$/.exec(declaration);
        if (!field) continue;

        const explicit = /rename\s*=\s*"([^"]+)"/.exec(fieldAttrs)?.[1];
        const mapped = rustTypeToTs(field[2]);
        const skipped = /skip_serializing_if/.test(fieldAttrs);

        fields.push({
          name: explicit ?? rename(field[1]),
          ts: mapped.ts,
          optional: mapped.optional || skipped,
        });
      }

      if (fields.length > 0) STRUCTS.set(name, { name, fields });
    }
  }
}

/**
 * Command names registered in `generate_handler![...]`, in declaration order.
 *
 * The list lives in `commands/handlers.rs`, but it is located by searching so
 * that moving it again does not silently produce an empty contract.
 */
function registeredCommands() {
  for (const file of rustFiles(RUST_SRC)) {
    const source = readFileSync(file, 'utf8');
    // Match the invocation itself, not a mention in a comment.
    const invocation = /generate_handler!\s*\[/.exec(source);
    if (!invocation) continue;

    const open = invocation.index + invocation[0].length - 1;
    const close = source.indexOf(']', open);
    if (close === -1) continue;

    const names = source
      .slice(open + 1, close)
      // Drop `// --- Group ---` comments used to organise the list.
      .replace(/\/\/[^\n]*/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((path) => path.split('::').pop());

    if (names.length > 0) return names;
  }

  throw new Error('generate_handler! with a non-empty command list was not found');
}

/** Every `#[tauri::command]` function found in the tree. */
function parseCommands() {
  const found = new Map();

  for (const file of rustFiles(RUST_SRC)) {
    const source = readFileSync(file, 'utf8');
    const attr = /#\[tauri::command(?:\([^)]*\))?\]/g;
    let match;

    while ((match = attr.exec(source)) !== null) {
      const signature = /(?:pub\s+)?(?:async\s+)?fn\s+([a-z0-9_]+)\s*\(/g;
      signature.lastIndex = match.index;
      const fn = signature.exec(source);
      if (!fn) continue;

      const params = balanced(source, signature.lastIndex - 1);
      if (!params) continue;

      const returnType = /^\s*->\s*([^{]+)\{/s.exec(source.slice(params.end + 1));
      const args = [];

      for (const param of splitTopLevel(params.body)) {
        const colon = param.indexOf(':');
        if (colon === -1) continue;
        const name = param.slice(0, colon).trim().replace(/^mut\s+/, '');
        const type = param.slice(colon + 1).trim();
        if (INJECTED.some((re) => re.test(type))) continue;
        const mapped = rustTypeToTs(type);
        args.push({ name: snakeToCamel(name), ts: mapped.ts, optional: mapped.optional });
      }

      found.set(fn[1], {
        name: fn[1],
        args,
        result: extractResult(returnType ? returnType[1] : ''),
        source: relative(ROOT, file),
      });
    }
  }

  return found;
}

/** `Result<T, E>` unwraps to T; a bare type is used directly. */
function extractResult(raw) {
  const type = raw.trim();
  const result = /^Result<(.+)>$/s.exec(type);
  if (result) {
    const [ok] = splitTopLevel(result[1]);
    return rustTypeToTs(ok ?? '()').ts;
  }
  if (!type) return 'void';
  return rustTypeToTs(type).ts;
}

export function buildContract() {
  STRUCTS.clear();
  USED_STRUCTS.clear();
  parseStructs();

  const all = parseCommands();
  const registered = registeredCommands();

  const missing = registered.filter((name) => !all.has(name));
  if (missing.length > 0) {
    throw new Error(
      `generate_handler! registers commands with no #[tauri::command] definition: ${missing.join(', ')}`,
    );
  }

  const commands = registered.map((name) => all.get(name));

  const argLines = commands.map((cmd) => {
    if (cmd.args.length === 0) {
      return `  '${cmd.name}': Record<string, never>;`;
    }
    const fields = cmd.args
      .map((a) => `${a.name}${a.optional ? '?' : ''}: ${a.ts}`)
      .join('; ');
    return `  '${cmd.name}': { ${fields} };`;
  });

  const resultLines = commands.map((cmd) => `  '${cmd.name}': ${cmd.result};`);

  // Close over structs referenced by other structs, then emit in a stable order.
  for (let changed = true; changed; ) {
    changed = false;
    for (const name of [...USED_STRUCTS]) {
      for (const field of STRUCTS.get(name)?.fields ?? []) {
        for (const candidate of field.ts.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
          if (STRUCTS.has(candidate) && !USED_STRUCTS.has(candidate)) {
            USED_STRUCTS.add(candidate);
            changed = true;
          }
        }
      }
    }
  }

  const structBlocks = [...USED_STRUCTS]
    .sort()
    .map((name) => {
      const { fields } = STRUCTS.get(name);
      const lines = fields
        .map((f) => `  ${f.name}${f.optional ? '?' : ''}: ${f.ts};`)
        .join('\n');
      return `export interface ${name} {\n${lines}\n}`;
    })
    .join('\n\n');

  return `// GENERATED FILE — DO NOT EDIT.
// Produced by scripts/generate-ipc.mjs from the #[tauri::command] definitions
// in src-tauri/src. Run \`npm run ipc:gen\` after changing a command.
//
// ${commands.length} commands registered in main.rs.
//
// \`unknown\` means the Rust type is not a serialisable struct this generator
// could resolve; narrow it with a cast at the call site.

${structBlocks}

/** Arguments accepted by each command, camelCased as Tauri expects. */
export interface IpcArgsMap {
${argLines.join('\n')}
}

/** Value each command resolves to. */
export interface IpcResultMap {
${resultLines.join('\n')}
}

export type IpcCommand = keyof IpcArgsMap;
export type IpcArgs<C extends IpcCommand> = IpcArgsMap[C];
export type IpcResult<C extends IpcCommand> = IpcResultMap[C];

/** Every registered command name, for runtime contract checks. */
export const IPC_COMMANDS = [
${commands.map((c) => `  '${c.name}',`).join('\n')}
] as const;
`;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const contract = buildContract();
  writeFileSync(OUTPUT, contract);
  const count = (contract.match(/^  '/gm) || []).length;
  console.log(`Wrote ${relative(ROOT, OUTPUT)} (${count / 3} commands)`);
}
