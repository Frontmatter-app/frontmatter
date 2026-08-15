/**
 * Security rules tests, run against the Firestore emulator.
 *
 * These are kept out of the default `vitest` run because they need a live
 * emulator (and therefore a Java runtime). Run them with:
 *
 *   npm run test:rules
 *
 * Each test below corresponds to a hole that was open before, or to a legitimate
 * access path that must survive closing it. The escalation cases are the point:
 * authorization used to be read from documents the caller could write.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const ATTACKER = 'attacker';
const OWNER = 'team-owner';
const MEMBER = 'team-member';
const TEAM = 'team-1';
const DOC = 'doc-1';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'frontmatter-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  // Seed with rules disabled: this is the state the backend would have written.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'users', OWNER), {
      email: 'owner@example.com',
      plan: 'team',
      planStatus: 'active',
      ownedTeamId: TEAM,
    });
    await setDoc(doc(db, 'users', MEMBER), { email: 'member@example.com', plan: 'free' });
    await setDoc(doc(db, 'users', ATTACKER), { email: 'attacker@example.com', plan: 'free' });

    await setDoc(doc(db, 'teams', TEAM), {
      ownerId: OWNER,
      name: 'Acme',
      members: [MEMBER],
      groups: { editors: { name: 'Editors', members: [MEMBER] } },
    });
    await setDoc(doc(db, 'teams', TEAM, 'members', MEMBER), {
      uid: MEMBER,
      groupIds: ['editors'],
      displayName: 'Member',
    });

    await setDoc(doc(db, 'cloud_documents', DOC), {
      id: DOC,
      ownerId: OWNER,
      teamId: TEAM,
      title: 'Shared',
      content: '{}',
      readableBy: ['*', OWNER],
    });

    await setDoc(doc(db, 'invites', 'invite-1'), {
      teamId: TEAM,
      invitedEmail: 'someone@example.com',
      token: 'secret-token',
      status: 'pending',
      invitedBy: OWNER,
    });
  });
});

describe('users/{uid}', () => {
  it('lets a user edit their own profile fields', async () => {
    const db = testEnv.authenticatedContext(MEMBER).firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', MEMBER), { displayName: 'New Name' }));
  });

  it('refuses a self-granted plan', async () => {
    // This single write used to buy an unlimited cloud plan for free.
    const db = testEnv.authenticatedContext(ATTACKER).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', ATTACKER), { plan: 'team', planStatus: 'active' }),
    );
  });

  it('refuses a self-asserted team membership', async () => {
    // And this one used to grant read/write over that team's entire workspace.
    const db = testEnv.authenticatedContext(ATTACKER).firestore();
    await assertFails(updateDoc(doc(db, 'users', ATTACKER), { teamMemberships: [TEAM] }));
    await assertFails(updateDoc(doc(db, 'users', ATTACKER), { teamId: TEAM }));
    await assertFails(updateDoc(doc(db, 'users', ATTACKER), { ownedTeamId: TEAM }));
  });

  it('refuses reading someone else’s profile', async () => {
    const db = testEnv.authenticatedContext(ATTACKER).firestore();
    await assertFails(getDoc(doc(db, 'users', OWNER)));
  });
});

describe('invites', () => {
  it('refuses reads, signed in or not', async () => {
    // Was `allow read: if true` — anyone could harvest every live invite token.
    await assertFails(getDocs(collection(testEnv.unauthenticatedContext().firestore(), 'invites')));
    await assertFails(
      getDoc(doc(testEnv.authenticatedContext(ATTACKER).firestore(), 'invites', 'invite-1')),
    );
  });

  it('refuses client-minted invites', async () => {
    const db = testEnv.authenticatedContext(ATTACKER).firestore();
    await assertFails(
      setDoc(doc(db, 'invites', 'forged'), {
        teamId: TEAM,
        invitedEmail: 'attacker@example.com',
        token: 'forged-token',
        status: 'pending',
      }),
    );
  });
});

describe('cloud_documents', () => {
  it('lets a group member with write access read and edit', async () => {
    const db = testEnv.authenticatedContext(MEMBER).firestore();
    await assertSucceeds(getDoc(doc(db, 'cloud_documents', DOC)));
    await assertSucceeds(updateDoc(doc(db, 'cloud_documents', DOC), { title: 'Edited' }));
  });

  it('refuses a non-member', async () => {
    const db = testEnv.authenticatedContext(ATTACKER).firestore();
    await assertFails(getDoc(doc(db, 'cloud_documents', DOC)));
    await assertFails(updateDoc(doc(db, 'cloud_documents', DOC), { title: 'Edited' }));
  });

  it('refuses a writer taking ownership or moving the document', async () => {
    const db = testEnv.authenticatedContext(MEMBER).firestore();
    await assertFails(updateDoc(doc(db, 'cloud_documents', DOC), { ownerId: MEMBER }));
    await assertFails(updateDoc(doc(db, 'cloud_documents', DOC), { teamId: 'other-team' }));
  });

  it('refuses a writer rewriting permissions', async () => {
    const db = testEnv.authenticatedContext(MEMBER).firestore();
    await assertFails(
      updateDoc(doc(db, 'cloud_documents', DOC), {
        filePermissions: { visibleTo: ['editors'] },
        readableBy: ['editors', OWNER],
      }),
    );
  });

  it('lets the team owner rewrite permissions', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'cloud_documents', DOC), {
        filePermissions: { visibleTo: ['editors'] },
        readableBy: ['editors', OWNER],
      }),
    );
  });

  it('rejects an index that disagrees with the permissions', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      updateDoc(doc(db, 'cloud_documents', DOC), {
        filePermissions: { visibleTo: ['editors'] },
        readableBy: ['*', OWNER],
      }),
    );
  });
});

describe('group restrictions', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      // Restricted to a group the member is not in.
      await setDoc(doc(db, 'cloud_documents', DOC), {
        id: DOC,
        ownerId: OWNER,
        teamId: TEAM,
        title: 'Restricted',
        content: '{}',
        filePermissions: { visibleTo: ['leads'] },
        readableBy: ['leads', OWNER],
      });
    });
  });

  it('hides a document restricted to another group', async () => {
    const db = testEnv.authenticatedContext(MEMBER).firestore();
    await assertFails(getDoc(doc(db, 'cloud_documents', DOC)));
  });

  it('resolves membership beyond the tenth group', async () => {
    // The old unrolled check only ever looked at the first ten groups, so a
    // member of the eleventh was silently denied.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const many = Array.from({ length: 12 }, (_, i) => `group-${i}`);
      await setDoc(doc(db, 'teams', TEAM, 'members', MEMBER), {
        uid: MEMBER,
        groupIds: many,
      });
      await setDoc(doc(db, 'cloud_documents', DOC), {
        id: DOC,
        ownerId: OWNER,
        teamId: TEAM,
        title: 'Restricted',
        content: '{}',
        filePermissions: { visibleTo: ['group-11'] },
        readableBy: ['group-11', OWNER],
      });
    });

    const db = testEnv.authenticatedContext(MEMBER).firestore();
    await assertSucceeds(getDoc(doc(db, 'cloud_documents', DOC)));
  });
});

describe('teams/{teamId}/members', () => {
  it('refuses a self-written membership record', async () => {
    // The whole escalation path closes here: membership is Admin-written only.
    const db = testEnv.authenticatedContext(ATTACKER).firestore();
    await assertFails(
      setDoc(doc(db, 'teams', TEAM, 'members', ATTACKER), { uid: ATTACKER, groupIds: [] }),
    );
  });

  it('lets a member read the roster', async () => {
    const db = testEnv.authenticatedContext(MEMBER).firestore();
    await assertSucceeds(getDocs(collection(db, 'teams', TEAM, 'members')));
  });
});
