/**
 * Frontmatter's own frames on the y-websocket wire.
 *
 * The sync and awareness frames belong to y-websocket and are left entirely
 * alone. These two are ours, numbered well clear of its range so that neither
 * side can mistake one for the other, and mirroring `server/collab/protocol.py`
 * exactly.
 *
 * The encoder is written out here rather than imported from `lib0` — which does
 * own this format, and which every Yjs package uses — because `lib0` is only in
 * the tree as somebody else's transitive dependency. Importing it directly
 * would mean depending on a package this project never declared, at whatever
 * version hoisting happened to produce. Two functions is a cheaper price than
 * that.
 */

/** Client → server: "here is a fresh grant, keep me connected." */
export const MSG_GRANT = 16;

/** Server → client: "your access in this room is now this." */
export const MSG_ACCESS = 17;

/** LEB128, as lib0 writes it. */
export function writeVarUint(value: number): Uint8Array {
  if (value < 0) throw new Error('varint cannot encode a negative value');
  const out: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining) byte |= 0x80;
    out.push(byte);
  } while (remaining);
  return new Uint8Array(out);
}

export function writeVarBytes(payload: Uint8Array): Uint8Array {
  const length = writeVarUint(payload.length);
  const frame = new Uint8Array(length.length + payload.length);
  frame.set(length, 0);
  frame.set(payload, length.length);
  return frame;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Frames a replacement grant for an already-open socket. */
export function encodeGrant(token: string): Uint8Array {
  return concat(writeVarUint(MSG_GRANT), writeVarBytes(new TextEncoder().encode(token)));
}
