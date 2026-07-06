import { create } from 'zustand';
import type { UploadState } from './imageTypes';

interface ImageStore {
  upload: UploadState;
  enqueueUpload: (id: string, name: string, size: number) => void;
  updateProgress: (id: string, progress: number) => void;
  removeUpload: (id: string) => void;
  clearQueue: () => void;
}

export const useImageStore = create<ImageStore>((set) => ({
  upload: { queue: [], active: false },
  enqueueUpload: (id, name, size) =>
    set((s) => ({
      upload: {
        queue: [...s.upload.queue, { id, name, size, progress: 0 }],
        active: true,
      },
    })),
  updateProgress: (id, progress) =>
    set((s) => ({
      upload: {
        ...s.upload,
        queue: s.upload.queue.map((item) =>
          item.id === id ? { ...item, progress } : item
        ),
      },
    })),
  removeUpload: (id) =>
    set((s) => {
      const queue = s.upload.queue.filter((item) => item.id !== id);
      return { upload: { queue, active: queue.length > 0 } };
    }),
  clearQueue: () => set({ upload: { queue: [], active: false } }),
}));
