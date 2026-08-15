#!/usr/bin/env node
/**
 * Backfills `teams/{teamId}/members/{uid}` membership documents.
 *
 * Run this BEFORE deploying the rules that depend on them. Membership used to be
 * read from the caller's own `users/{uid}` record — `ownedTeamId`,
 * `teamMemberships`, or a legacy `teamId` — every one of which the caller can
 * write, so anyone could join any team by editing their own profile. The rules
 * now read membership only from these documents, which are written exclusively
 * with Admin credentials.
 *
 * Until a team has been backfilled, its members will be denied access to its
 * documents, so this must land first.
 *
 *   node scripts/backfill-team-members.mjs --credentials ./service-account.json --dry-run
 *   node scripts/backfill-team-members.mjs --credentials ./service-account.json
 *
 * Membership is reconstructed from `teams/{id}.members` (authoritative — it lives
 * on the team, not the user) crossed with `teams/{id}.groups` for `groupIds`.
 * Team owners are not written a membership document: the rules treat ownership as
 * implicit membership, read from the team record itself.
 *
 * Idempotent: a member whose document already matches is skipped, so it is safe
 * to re-run, and safe to run again after the deploy to catch anything in between.
 */
import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const BATCH_LIMIT = 400; // Firestore allows 500 writes per batch; leave headroom.

/** Inverts a team's group map into per-member group id lists. */
function groupIdsByMember(groups) {
  const byMember = new Map();
  for (const [groupId, group] of Object.entries(groups ?? {})) {
    for (const uid of group?.members ?? []) {
      if (!byMember.has(uid)) byMember.set(uid, []);
      byMember.get(uid).push(groupId);
    }
  }
  return byMember;
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
  const teams = await db.collection('teams').get();

  let teamsChecked = 0;
  let written = 0;
  let batch = db.batch();
  let pending = 0;

  for (const team of teams.docs) {
    teamsChecked += 1;
    const data = team.data();
    const ownerId = data.ownerId;
    const byMember = groupIdsByMember(data.groups);

    const memberIds = Array.isArray(data.members)
      ? data.members
      : Object.keys(data.members ?? {});

    for (const uid of memberIds) {
      // Ownership is checked against the team record, so the owner needs no row.
      if (!uid || uid === ownerId) continue;

      const ref = team.ref.collection('members').doc(uid);
      const groupIds = byMember.get(uid) ?? [];

      const existing = await ref.get();
      if (existing.exists && sameSet(existing.data()?.groupIds, groupIds)) continue;

      // The profile fields are a convenience for the roster; a missing user
      // record is not a reason to skip the membership itself.
      const userSnap = await db.collection('users').doc(uid).get();
      const profile = userSnap.exists ? userSnap.data() : {};

      written += 1;
      if (args.dryRun) {
        console.log(`would write teams/${team.id}/members/${uid} -> groups [${groupIds.join(', ')}]`);
        continue;
      }

      batch.set(
        ref,
        {
          uid,
          groupIds,
          displayName: profile.displayName ?? null,
          email: profile.email ?? null,
          photoURL: profile.photoURL ?? null,
          joinedAt: admin.default.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      pending += 1;
      if (pending >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }

  if (!args.dryRun && pending > 0) await batch.commit();

  console.log(
    `${args.dryRun ? '[dry run] ' : ''}checked ${teamsChecked} team${teamsChecked === 1 ? '' : 's'}, ` +
    `${written} membership document${written === 1 ? '' : 's'} ${args.dryRun ? 'would be written' : 'written'}.`,
  );
  exit(0);
}

main().catch((error) => {
  console.error(error);
  exit(1);
});
