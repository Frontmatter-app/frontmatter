import { create } from 'zustand';

interface ExcalidrawStore {
  isOpen: boolean;
  mode: 'annotate-image' | 'new-drawing';
  imageUrl: string | null;
  imageAlt: string | null;
  documentId: string | null;
  /**
   * Source range of the image being annotated.
   *
   * Carried so the save rewrites the instance the user clicked. Matching by URL
   * rewrote the first occurrence in the document instead, which is the wrong one
   * whenever the same image appears twice.
   */
  sourceFrom: number | null;
  sourceTo: number | null;
  onSave: ((url: string) => void) | null;
  open: (opts: {
    mode: 'annotate-image' | 'new-drawing';
    imageUrl?: string;
    imageAlt?: string;
    documentId: string;
    sourceFrom?: number;
    sourceTo?: number;
    onSave?: (url: string) => void;
  }) => void;
  close: () => void;
}

export const useExcalidrawStore = create<ExcalidrawStore>((set) => ({
  isOpen: false,
  mode: 'new-drawing',
  imageUrl: null,
  imageAlt: null,
  documentId: null,
  sourceFrom: null,
  sourceTo: null,
  onSave: null,
  open: (opts) =>
    set({
      isOpen: true,
      onSave: opts.onSave ?? null,
      sourceFrom: opts.sourceFrom ?? null,
      sourceTo: opts.sourceTo ?? null,
      ...opts,
    }),
  close: () =>
    set({
      isOpen: false,
      mode: 'new-drawing',
      imageUrl: null,
      imageAlt: null,
      documentId: null,
      sourceFrom: null,
      sourceTo: null,
      onSave: null,
    }),
}));
