import { beforeEach, describe, expect, it } from 'vitest';
import { readOnlyReasonFor } from './ReadOnlyNotice';
import { isRoomReadOnly, useRoomStore } from './roomStore';

const MEMBERSHIP = {
  roomId: 'r1_abc',
  access: 'write' as const,
  verification: 'unverified' as const,
};

beforeEach(() => useRoomStore.setState({ rooms: {} }));

describe('room membership', () => {
  it('records what a room granted', () => {
    useRoomStore.getState().join('doc-1', MEMBERSHIP);
    expect(useRoomStore.getState().rooms['doc-1']).toEqual(MEMBERSHIP);
  });

  it('lowers access without losing the rest of the membership', () => {
    // The case verification produces: joined optimistically as a writer, then
    // told otherwise a second later.
    useRoomStore.getState().join('doc-1', MEMBERSHIP);
    useRoomStore.getState().setAccess('doc-1', 'read');

    expect(useRoomStore.getState().rooms['doc-1']).toEqual({ ...MEMBERSHIP, access: 'read' });
  });

  it('ignores access for a document that is not in a room', () => {
    useRoomStore.getState().setAccess('doc-nobody', 'read');
    expect(useRoomStore.getState().rooms['doc-nobody']).toBeUndefined();
  });

  it('forgets a document when it leaves', () => {
    useRoomStore.getState().join('doc-1', MEMBERSHIP);
    useRoomStore.getState().leave('doc-1');
    expect(useRoomStore.getState().rooms['doc-1']).toBeUndefined();
  });

  it('keeps documents separate', () => {
    useRoomStore.getState().join('doc-1', MEMBERSHIP);
    useRoomStore.getState().join('doc-2', { ...MEMBERSHIP, access: 'read' });

    expect(useRoomStore.getState().rooms['doc-1'].access).toBe('write');
    expect(useRoomStore.getState().rooms['doc-2'].access).toBe('read');
  });
});

describe('whether a room forbids writing', () => {
  it('is false for a document in no room at all', () => {
    // The common case, and the one that must never be mistaken for "no
    // permission": a document nobody else is in is fully editable.
    expect(isRoomReadOnly('doc-1')).toBe(false);
  });

  it('is false with no document', () => {
    expect(isRoomReadOnly(null)).toBe(false);
  });

  it('is false for a writer', () => {
    useRoomStore.getState().join('doc-1', MEMBERSHIP);
    expect(isRoomReadOnly('doc-1')).toBe(false);
  });

  it('is true for a reader', () => {
    useRoomStore.getState().join('doc-1', { ...MEMBERSHIP, access: 'read' });
    expect(isRoomReadOnly('doc-1')).toBe(true);
  });
});

describe('which constraint to report', () => {
  it('reports nothing when both allow writing', () => {
    expect(readOnlyReasonFor({ roomAccess: 'write', canWrite: true })).toBeNull();
  });

  it('reports nothing when there is no room and permissions allow it', () => {
    expect(readOnlyReasonFor({ roomAccess: undefined, canWrite: true })).toBeNull();
  });

  it('reports the repository when the room grants only read', () => {
    expect(readOnlyReasonFor({ roomAccess: 'read', canWrite: true })).toBe('room');
  });

  it('reports permissions when the repository allows it but the file does not', () => {
    expect(readOnlyReasonFor({ roomAccess: 'write', canWrite: false })).toBe('permissions');
  });

  it('reports the repository first when both forbid it', () => {
    // The outer constraint wins: no permissions file inside a repository can
    // grant write access to a repository you may only read, so naming the file
    // would send someone to do something that cannot work.
    expect(readOnlyReasonFor({ roomAccess: 'read', canWrite: false })).toBe('room');
  });

  it('reports permissions when there is no room', () => {
    expect(readOnlyReasonFor({ roomAccess: undefined, canWrite: false })).toBe('permissions');
  });
});
