import * as Y from 'yjs';
import { uint8ToBase64, base64ToUint8 } from '../lib/base64';

/**
 * Serialisation for `Y.RelativePosition`.
 *
 * A relative position is what makes an annotation stay attached to its text as
 * the document changes around it. It was being stored by handing the object
 * straight to `Y.Map.set` and `JSON.stringify`, which keeps the shape but loses
 * the class: the `Y.ID` instances inside become plain `{client, clock}` objects.
 * `Y.createAbsolutePositionFromRelativePosition` then cannot resolve them, so
 * every anchor broke as soon as it round-tripped through storage or a peer —
 * which is to say, on the next reload.
 *
 * Yjs has a binary encoding for exactly this. These wrap it in base64 so the
 * result is safe in JSON, in a `Y.Map`, and in a SQLite text column.
 */

export function encodeRelativePosition(position: Y.RelativePosition): string {
  return uint8ToBase64(Y.encodeRelativePosition(position));
}

/**
 * Returns `null` for anything unreadable — including the legacy plain-object
 * form, which cannot be recovered. A dropped anchor renders as an unanchored
 * comment; a malformed one would throw while rendering the sidebar.
 */
export function decodeRelativePosition(encoded: unknown): Y.RelativePosition | null {
  if (typeof encoded !== 'string' || encoded.length === 0) return null;
  try {
    return Y.decodeRelativePosition(base64ToUint8(encoded));
  } catch {
    return null;
  }
}

/** Resolves an encoded position to a document offset, or `null` if it is gone. */
export function resolveIndex(encoded: unknown, ydoc: Y.Doc): number | null {
  const relative = decodeRelativePosition(encoded);
  if (!relative) return null;
  return toAbsolute(relative, ydoc)?.index ?? null;
}

/**
 * Null-safe `Y.createAbsolutePositionFromRelativePosition`.
 *
 * An anchor can legitimately be missing — the text it pointed at was deleted, or
 * it was written in the old unencodable format and could not be decoded. Yjs's
 * own function throws on a null position, and this codebase has
 * `strictNullChecks` off, so nothing would have flagged it at build time. Every
 * caller already handles a `null` result, since a position can fail to resolve
 * anyway.
 */
export function toAbsolute(
  position: Y.RelativePosition | null | undefined,
  ydoc: Y.Doc | null | undefined,
): { type: Y.AbstractType<any> | null; index: number; assoc: number } | null {
  if (!position || !ydoc) return null;
  try {
    return Y.createAbsolutePositionFromRelativePosition(position, ydoc);
  } catch {
    return null;
  }
}
