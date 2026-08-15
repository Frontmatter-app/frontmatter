import * as Y from 'yjs';
import { invoke } from '../filesystem/tauriCommands';
import { encodeRelativePosition, decodeRelativePosition } from './relativePositions';

export interface AnnotationReply {
  id: string;
  author_id: string;
  text: string;
  created_at: string;
}

export interface Annotation {
  id: string;
  document_id: string;
  author_id: string;
  start_pos: Y.RelativePosition | null;
  end_pos: Y.RelativePosition | null;
  selected_text: string;
  note: string;
  resolved: boolean;
  created_at: string;
  replies: AnnotationReply[];
}

/**
 * Comments anchored to ranges of the document.
 *
 * Two things are deliberate about the storage shape:
 *
 *  - **Each annotation is a `Y.Map`, and its replies are a `Y.Array`.** They
 *    used to be plain objects written whole with `ymap.set(id, {...ann})`, so
 *    every mutation was a read-modify-write of the entire annotation. Two people
 *    replying at once, or one replying while another resolved, silently kept
 *    only the last write. Per-field entries let those merge, which is the point
 *    of storing them in a CRDT at all.
 *
 *  - **Positions are stored encoded.** See `relativePositions.ts`: handing a
 *    `Y.RelativePosition` to `Y.Map.set` loses the class and breaks the anchor.
 */
export class AnnotationManager {
  private ydoc: Y.Doc;
  private ymap: Y.Map<Y.Map<any>>;
  private documentId: string;

  constructor(ydoc: Y.Doc, documentId: string) {
    this.ydoc = ydoc;
    this.documentId = documentId;
    this.ymap = ydoc.getMap('annotations');
    void this.loadInitial();
  }

  /** Hydrates from the local database, without disturbing what is already shared. */
  private async loadInitial(): Promise<void> {
    let rows: any[] = [];
    try {
      rows = await invoke('get_annotations', { documentId: this.documentId });
    } catch (e) {
      console.error('Failed to load annotations', e);
      return;
    }

    this.ydoc.transact(() => {
      for (const row of rows) {
        // Present already: the shared copy is authoritative, and re-adding it
        // would clobber replies and resolutions made by other people.
        if (this.ymap.has(row.id)) continue;
        try {
          this.ymap.set(row.id, this.buildEntry({
            id: row.id,
            document_id: row.document_id,
            author_id: row.author_id,
            start_pos: row.start_pos,
            end_pos: row.end_pos,
            selected_text: row.selected_text,
            note: row.note,
            resolved: !!row.resolved,
            created_at: row.created_at,
            replies: row.replies ? JSON.parse(row.replies) : [],
          }));
        } catch (e) {
          console.error('Skipping unreadable annotation row', row?.id, e);
        }
      }
    }, 'load-annotations');
  }

  private buildEntry(fields: {
    id: string;
    document_id: string;
    author_id: string;
    start_pos: string;
    end_pos: string;
    selected_text: string;
    note: string;
    resolved: boolean;
    created_at: string;
    replies: AnnotationReply[];
  }): Y.Map<any> {
    const entry = new Y.Map<any>();
    entry.set('id', fields.id);
    entry.set('document_id', fields.document_id);
    entry.set('author_id', fields.author_id);
    entry.set('start_pos', fields.start_pos);
    entry.set('end_pos', fields.end_pos);
    entry.set('selected_text', fields.selected_text);
    entry.set('note', fields.note);
    entry.set('resolved', fields.resolved);
    entry.set('created_at', fields.created_at);

    const replies = new Y.Array<AnnotationReply>();
    if (fields.replies.length > 0) replies.push(fields.replies);
    entry.set('replies', replies);
    return entry;
  }

  addAnnotation(
    id: string,
    documentId: string,
    authorId: string,
    startPos: Y.RelativePosition,
    endPos: Y.RelativePosition,
    selectedText: string,
    note: string,
  ): void {
    const encodedStart = encodeRelativePosition(startPos);
    const encodedEnd = encodeRelativePosition(endPos);
    const createdAt = new Date().toISOString();

    this.ydoc.transact(() => {
      this.ymap.set(id, this.buildEntry({
        id,
        document_id: documentId,
        author_id: authorId,
        start_pos: encodedStart,
        end_pos: encodedEnd,
        selected_text: selectedText,
        note,
        resolved: false,
        created_at: createdAt,
        replies: [],
      }));
    }, 'add-annotation');

    invoke('save_annotation', {
      annotation: {
        id,
        document_id: documentId,
        author_id: authorId,
        start_pos: encodedStart,
        end_pos: encodedEnd,
        selected_text: selectedText,
        note,
        resolved: false,
        created_at: createdAt,
      },
    }).catch((e) => console.error('Failed to persist annotation', e));
  }

  resolveAnnotation(id: string): void {
    const entry = this.ymap.get(id);
    if (!entry) return;
    // A single field, so a concurrent reply is not lost to this write.
    entry.set('resolved', true);
    invoke('resolve_annotation', { id }).catch((e) =>
      console.error('Failed to persist resolution', e),
    );
  }

  addReply(annotationId: string, replyText: string, authorId: string): void {
    const entry = this.ymap.get(annotationId);
    if (!entry) return;

    const replies = entry.get('replies') as Y.Array<AnnotationReply> | undefined;
    if (!replies) return;

    // Appending to a Y.Array converges: two simultaneous replies both survive,
    // where rewriting a plain array kept only one.
    replies.push([{
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      author_id: authorId,
      text: replyText,
      created_at: new Date().toISOString(),
    }]);
  }

  getAnnotations(): Annotation[] {
    const out: Annotation[] = [];
    this.ymap.forEach((entry) => {
      if (!entry) return;
      const replies = entry.get('replies');
      out.push({
        id: entry.get('id'),
        document_id: entry.get('document_id'),
        author_id: entry.get('author_id'),
        // Decoded here so callers keep working with `Y.RelativePosition`.
        start_pos: decodeRelativePosition(entry.get('start_pos')),
        end_pos: decodeRelativePosition(entry.get('end_pos')),
        selected_text: entry.get('selected_text'),
        note: entry.get('note'),
        resolved: !!entry.get('resolved'),
        created_at: entry.get('created_at'),
        replies: replies instanceof Y.Array ? replies.toArray() : [],
      });
    });
    return out;
  }

  /** Fires for replies and resolutions too, not just added or removed annotations. */
  observe(callback: () => void): void {
    this.ymap.observeDeep(callback);
  }

  unobserve(callback: () => void): void {
    this.ymap.unobserveDeep(callback);
  }
}
