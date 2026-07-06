import * as Y from 'yjs';

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
  start_pos: Y.RelativePosition;
  end_pos: Y.RelativePosition;
  text: string;          // The text inserted or deleted
  resolved: boolean;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  replies?: SuggestionReply[];
}

export class SuggestionManager {
  private ydoc: Y.Doc;
  private ymap: Y.Map<any>;
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
    text: string
  ): Suggestion {
    const suggestion: Suggestion = {
      id,
      document_id: this.documentId,
      author_id: authorId,
      type,
      start_pos: startPos,
      end_pos: endPos,
      text,
      resolved: false,
      status: 'pending',
      created_at: new Date().toISOString(),
      replies: []
    };
    this.ymap.set(id, suggestion);
    return suggestion;
  }

  updateSuggestion(id: string, updated: Partial<Suggestion>) {
    const existing = this.ymap.get(id);
    if (existing) {
      this.ymap.set(id, { ...existing, ...updated });
    }
  }

  resolveSuggestion(id: string, status: 'accepted' | 'rejected') {
    const suggestion = this.ymap.get(id) as Suggestion;
    if (suggestion) {
      this.ymap.set(id, { ...suggestion, resolved: true, status });
    }
  }

  addReply(suggestionId: string, replyText: string, authorId: string) {
    const suggestion = this.ymap.get(suggestionId) as Suggestion;
    if (suggestion) {
      const replies = suggestion.replies || [];
      const newReply: SuggestionReply = {
        id: Math.random().toString(36).substring(2, 9),
        author_id: authorId,
        text: replyText,
        created_at: new Date().toISOString()
      };
      this.ymap.set(suggestionId, {
        ...suggestion,
        replies: [...replies, newReply]
      });
    }
  }

  getSuggestions(): Suggestion[] {
    const result: Suggestion[] = [];
    for (const sug of this.ymap.values()) {
      result.push(sug as Suggestion);
    }
    return result;
  }

  observe(callback: () => void) {
    this.ymap.observe(callback);
  }

  unobserve(callback: () => void) {
    this.ymap.unobserve(callback);
  }
}
