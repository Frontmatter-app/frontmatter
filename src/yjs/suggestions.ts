import * as Y from 'yjs';
import { encodeRelativePosition, decodeRelativePosition } from './relativePositions';

export interface SuggestionReply {
  id: string;
  author_id: string;
  text: string;
  created_at: string;
}

export interface Suggestion {
  id: string;
  document_id: string;
  author_id: string;
  type: 'insert' | 'delete';
  start_pos: Y.RelativePosition | null;
  end_pos: Y.RelativePosition | null;
  text: string;
  resolved: boolean;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  replies: SuggestionReply[];
}

/**
 * Tracked changes, anchored to ranges of the document.
 *
 * Same storage shape as `AnnotationManager`, for the same two reasons: each
 * suggestion is a `Y.Map` with its replies in a `Y.Array` so concurrent replies
 * and accept/reject decisions merge instead of overwriting each other, and
 * positions are stored encoded so anchors survive a round trip.
 */
export class SuggestionManager {
  private ydoc: Y.Doc;
  private ymap: Y.Map<Y.Map<any>>;
  private documentId: string;

  constructor(ydoc: Y.Doc, documentId: string) {
    this.ydoc = ydoc;
    this.documentId = documentId;
    this.ymap = ydoc.getMap('suggestions');
  }

  addSuggestion(
    id: string,
    authorId: string,
    type: 'insert' | 'delete',
    startPos: Y.RelativePosition,
    endPos: Y.RelativePosition,
    text: string,
  ): Suggestion {
    const createdAt = new Date().toISOString();

    this.ydoc.transact(() => {
      const entry = new Y.Map<any>();
      entry.set('id', id);
      entry.set('document_id', this.documentId);
      entry.set('author_id', authorId);
      entry.set('type', type);
      entry.set('start_pos', encodeRelativePosition(startPos));
      entry.set('end_pos', encodeRelativePosition(endPos));
      entry.set('text', text);
      entry.set('resolved', false);
      entry.set('status', 'pending');
      entry.set('created_at', createdAt);
      entry.set('replies', new Y.Array<SuggestionReply>());
      this.ymap.set(id, entry);
    }, 'add-suggestion');

    return {
      id,
      document_id: this.documentId,
      author_id: authorId,
      type,
      start_pos: startPos,
      end_pos: endPos,
      text,
      resolved: false,
      status: 'pending',
      created_at: createdAt,
      replies: [],
    };
  }

  /** Writes only the fields given, so it cannot clobber a concurrent reply. */
  updateSuggestion(id: string, updated: Partial<Suggestion>): void {
    const entry = this.ymap.get(id);
    if (!entry) return;

    this.ydoc.transact(() => {
      for (const [key, value] of Object.entries(updated)) {
        if (key === 'replies') continue; // owned by the Y.Array
        if (key === 'start_pos' || key === 'end_pos') {
          if (value) entry.set(key, encodeRelativePosition(value as Y.RelativePosition));
          continue;
        }
        entry.set(key, value);
      }
    }, 'update-suggestion');
  }

  resolveSuggestion(id: string, status: 'accepted' | 'rejected'): void {
    const entry = this.ymap.get(id);
    if (!entry) return;
    this.ydoc.transact(() => {
      entry.set('resolved', true);
      entry.set('status', status);
    }, 'resolve-suggestion');
  }

  addReply(suggestionId: string, replyText: string, authorId: string): void {
    const entry = this.ymap.get(suggestionId);
    if (!entry) return;

    const replies = entry.get('replies') as Y.Array<SuggestionReply> | undefined;
    if (!replies) return;

    replies.push([{
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      author_id: authorId,
      text: replyText,
      created_at: new Date().toISOString(),
    }]);
  }

  getSuggestions(): Suggestion[] {
    const out: Suggestion[] = [];
    this.ymap.forEach((entry) => {
      if (!entry) return;
      const replies = entry.get('replies');
      out.push({
        id: entry.get('id'),
        document_id: entry.get('document_id'),
        author_id: entry.get('author_id'),
        type: entry.get('type'),
        start_pos: decodeRelativePosition(entry.get('start_pos')),
        end_pos: decodeRelativePosition(entry.get('end_pos')),
        text: entry.get('text'),
        resolved: !!entry.get('resolved'),
        status: entry.get('status'),
        created_at: entry.get('created_at'),
        replies: replies instanceof Y.Array ? replies.toArray() : [],
      });
    });
    return out;
  }

  observe(callback: () => void): void {
    this.ymap.observeDeep(callback);
  }

  unobserve(callback: () => void): void {
    this.ymap.unobserveDeep(callback);
  }
}
