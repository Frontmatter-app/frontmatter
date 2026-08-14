#!/usr/bin/env node
/**
 * Backfills the `readableBy` query index onto existing cloud documents.
 *
 * Run this BEFORE deploying the rules and the client that rely on it. Until a
 * document has the index it will not match the new single-listener query, so
 * team members would not see it — the rules keep such documents writable, but
 * they stay invisible until this has run.
 *
 *   node scripts/backfill-readable-by.mjs --credentials ./service-account.json --dry-run
 *   node scripts/backfill-readable-by.mjs --credentials ./service-account.json
 *
 * The script is idempotent: documents whose index already matches are skipped,
 * so it is safe to re-run, and safe to run again after the deploy to catch
 * anything written in between.
 */
import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const UNRESTRICTED = '*';
const BATCH_LIMIT = 400; // Firestore allows 500 writes per batch; leave headroom.

/** Mirrors `deriveReadableBy` in src/cloud/readableBy.ts and the security rules. */
function deriveReadableBy(ownerId, visibleTo) {
  const groups = (visibleTo ?? []).filter(Boolean);
  const base = groups.length === 0 ? [UNRESTRICTED] : groups;
  const tokens = ownerId ? [...base, ownerId] : base;
  return Array.from(new Set(tokens));
}

function sameSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function parseArgs() {
  const args = { dryRun: false, credentials: null, projectId: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--credentials') args.credentials = argv[++i];
    else if (arg === '--project') args.projectId = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
      exit(0);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();

  let admin;
  try {
    admin = await import('firebase-admin');
  } catch {
    console.error(
      'firebase-admin is required to run this script:\n  npm install --no-save firebase-admin',
    );
    exit(1);
  }

  const app = admin.default.initializeApp({
    credential: args.credentials
      ? admin.default.credential.cert(JSON.parse(readFileSync(args.credentials, 'utf8')))
      : admin.default.credential.applicationDefault(),
    projectId: args.projectId ?? undefined,
  });

  const db = admin.default.firestore(app);
  const snapshot = await db.collection('cloud_documents').get();

  let checked = 0;
  let updated = 0;
  let batch = db.batch();
  let pending = 0;

  for (const document of snapshot.docs) {
    checked += 1;
    const data = document.data();
    const expected = deriveReadableBy(data.ownerId, data.filePermissions?.visibleTo);

    if (sameSet(data.readableBy, expected)) continue;

    updated += 1;
    if (args.dryRun) {
      console.log(`would set ${document.id} -> [${expected.join(', ')}]`);
      continue;
    }

    batch.update(document.ref, { readableBy: expected });
    pending += 1;
    if (pending >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (!args.dryRun && pending > 0) await batch.commit();

  console.log(
    `${args.dryRun ? '[dry run] ' : ''}checked ${checked} document${checked === 1 ? '' : 's'}, ` +
    `${updated} ${args.dryRun ? 'would be updated' : 'updated'}.`,
  );
  exit(0);
}

main().catch((error) => {
  console.error(error);
  exit(1);
});
