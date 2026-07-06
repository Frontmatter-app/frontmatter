import * as Y from 'yjs';
import { invoke } from '../filesystem/tauriCommands';

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
  start_pos: Y.RelativePosition;
  end_pos: Y.RelativePosition;
  selected_text: string;
  note: string;
  resolved: boolean;
  created_at: string;
  replies?: AnnotationReply[];
}

export class AnnotationManager {
  private ydoc: Y.Doc;
  private ymap: Y.Map<any>;
  private documentId: string;

  constructor(ydoc: Y.Doc, documentId: string) {
    this.ydoc = ydoc;
    this.documentId = documentId;
    this.ymap = ydoc.getMap('annotations');
    this.loadInitial();
  }
  
  private async loadInitial() {
     try {
       const rows: any[] = await invoke('get_annotations', { documentId: this.documentId });
       
       this.ydoc.transact(() => {
         for (const row of rows) {
            try {
              const ann: Annotation = {
                id: row.id,
                document_id: row.document_id,
                author_id: row.author_id,
                start_pos: JSON.parse(row.start_pos),
                end_pos: JSON.parse(row.end_pos),
                selected_text: row.selected_text,
                note: row.note,
                 resolved: row.resolved,
                 created_at: row.created_at,
                 replies: row.replies ? JSON.parse(row.replies) : []
               };
              if (!this.ymap.has(ann.id)) {
                this.ymap.set(ann.id, ann);
              }
            } catch (e) {
              console.error("Failed to parse annotation row", e);
            }
         }
       }, 'load-annotations');
     } catch (e) {
       console.error("Failed to load annotations API", e);
     }
  }

  addAnnotation(
    id: string,
    documentId: string,
    authorId: string,
    startPos: Y.RelativePosition,
    endPos: Y.RelativePosition,
    selectedText: string,
    note: string
  ): void {
    const ann: Annotation = {
      id,
      document_id: documentId,
      author_id: authorId,
      start_pos: startPos,
      end_pos: endPos,
      selected_text: selectedText,
      note,
      resolved: false,
      created_at: new Date().toISOString(),
      replies: []
    };
    
    this.ymap.set(id, ann);
    
    // Save to sqlite
    invoke('save_annotation', { 
       annotation: {
         id: ann.id,
         document_id: ann.document_id,
         author_id: ann.author_id,
         start_pos: JSON.stringify(ann.start_pos),
         end_pos: JSON.stringify(ann.end_pos),
         selected_text: ann.selected_text,
         note: ann.note,
         resolved: ann.resolved,
         created_at: ann.created_at
       }
    }).catch(console.error);
  }

  resolveAnnotation(id: string): void {
    const ann = this.ymap.get(id) as Annotation;
    if (ann) {
      const updated = { ...ann, resolved: true };
      this.ymap.set(id, updated);
      invoke('resolve_annotation', { id }).catch(console.error);
    }
  }

  addReply(annotationId: string, replyText: string, authorId: string) {
    const ann = this.ymap.get(annotationId) as Annotation;
    if (ann) {
      const replies = ann.replies || [];
      const newReply: AnnotationReply = {
        id: Math.random().toString(36).substring(2, 9),
        author_id: authorId,
        text: replyText,
        created_at: new Date().toISOString()
      };
      const updated = {
        ...ann,
        replies: [...replies, newReply]
      };
      this.ymap.set(annotationId, updated);
      
      // Save updated replies to sqlite if needed, but since sqlite schema might not have it yet,
      // YJS is our collaborative source of truth.
    }
  }

  getAnnotations(): Annotation[] {
    const result: Annotation[] = [];
    for (const ann of this.ymap.values()) {
      result.push(ann as Annotation);
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
