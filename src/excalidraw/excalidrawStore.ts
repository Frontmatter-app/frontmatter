import { create } from 'zustand';

interface ExcalidrawStore {
  isOpen: boolean;
  mode: 'annotate-image' | 'new-drawing';
  imageUrl: string | null;
  imageAlt: string | null;
  documentId: string | null;
  onSave: ((url: string) => void) | null;
  open: (opts: {
    mode: 'annotate-image' | 'new-drawing';
    imageUrl?: string;
    imageAlt?: string;
    documentId: string;
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
  onSave: null,
  open: (opts) => set({ isOpen: true, onSave: opts.onSave ?? null, ...opts }),
  close: () =>
    set({
      isOpen: false,
      mode: 'new-drawing',
      imageUrl: null,
      imageAlt: null,
      documentId: null,
      onSave: null,
    }),
}));
