/**
 * Why this document will not accept typing.
 *
 * A read-only editor with no explanation is indistinguishable from a broken
 * one, and the two reasons a document can be read-only call for different
 * sentences: one is about the repository, and is answered by asking whoever
 * administers it; the other is about a permissions file inside it, and is
 * answered by editing that file. Telling somebody the wrong one sends them to
 * the wrong person.
 */
import React from 'react';
import { Lock } from 'lucide-react';
import './readOnlyNotice.css';

export type ReadOnlyReason = 'room' | 'permissions';

const MESSAGES: Record<ReadOnlyReason, string> = {
  room: 'Read-only — you have read access to this repository, so your changes cannot be saved to it.',
  permissions: "Read-only — your group doesn't have write access to this document.",
};

/**
 * Which of the two constraints is stopping this person writing.
 *
 * The repository wins when both apply, because it is the outer one: no
 * permissions file *inside* a repository can grant write access to a repository
 * you may only read, so pointing someone at that file would send them to do
 * something that cannot work.
 */
export function readOnlyReasonFor(input: {
  roomAccess: 'read' | 'write' | undefined;
  canWrite: boolean;
}): ReadOnlyReason | null {
  if (input.roomAccess === 'read') return 'room';
  if (!input.canWrite) return 'permissions';
  return null;
}

export function ReadOnlyNotice({ reason }: { reason: ReadOnlyReason | null }) {
  if (!reason) return null;

  return (
    <div className="read-only-notice" role="status">
      <Lock className="read-only-notice__icon" aria-hidden />
      <span>{MESSAGES[reason]}</span>
    </div>
  );
}
