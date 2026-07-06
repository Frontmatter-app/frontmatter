import { create } from 'zustand';

interface ExcalidrawStore {
  isOpen: boolean;
  mode: 'annotate-image' | 'new-drawing';
  imageUrl: string | null;
  imageAlt: string | null;
  documentId: string | null;
  open: (opts: {
    mode: 'annotate-image' | 'new-drawing';
    imageUrl?: string;
    imageAlt?: string;
    documentId: string;
  }) => void;
  close: () => void;
}

export const useExcalidrawStore = create<ExcalidrawStore>((set) => ({
  isOpen: false,
  mode: 'new-drawing',
  imageUrl: null,
  imageAlt: null,
  documentId: null,
  open: (opts) => set({ isOpen: true, ...opts }),
  close: () =>
    set({
      isOpen: false,
      mode: 'new-drawing',
      imageUrl: null,
      imageAlt: null,
      documentId: null,
    }),
}));
