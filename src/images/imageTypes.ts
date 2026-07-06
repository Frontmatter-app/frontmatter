export interface ImageContext {
  docDir?: string;
  documentId: string;
  isCloud: boolean;
  teamId?: string;
  uid?: string;
}

export interface ImageResult {
  url: string;
  localPath?: string;
  isExternal: boolean;
  isCloud: boolean;
}

export interface UploadState {
  queue: { id: string; name: string; size: number; progress: number }[];
  active: boolean;
}
