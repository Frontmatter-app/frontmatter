import { exportToBlob, CaptureUpdateAction } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types';
import * as Y from 'yjs';
import { fetchImageAsDataURL, getImageBaseName, generateId } from '../images/imageUtils';
import { resolveImageUrl, importToAssets, saveAnnotatedImage, saveEditingState, loadEditingState, deleteEditingState } from '../images/imageService';
import type { ImageContext } from '../images/imageTypes';

const EXCALIDRAW_MAP_KEY = 'excalidraw';
const FILES_MAP_KEY = 'excalidraw-files';

export async function loadImageIntoScene(
  api: ExcalidrawImperativeAPI,
  imageUrl: string,
): Promise<void> {
  const resolvedUrl = resolveImageUrl(imageUrl);
  const { dataURL, blob, width, height } = await fetchImageAsDataURL(resolvedUrl);
  const fileId = generateId();

  api.addFiles([{
    id: fileId,
    dataURL,
    mimeType: (blob.type || 'image/png') as any,
    created: Date.now(),
  } as BinaryFileData]);

  const imageElement: any = {
    id: generateId(),
    type: 'image',
    x: 0,
    y: 0,
    width,
    height,
    fileId,
    status: 'saved',
    scale: [1, 1],
    crop: null,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roundness: null,
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: Math.floor(Math.random() * 100000),
    version: 1,
    versionNonce: 0,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: true,
  };

  api.updateScene({
    elements: [imageElement],
    captureUpdate: CaptureUpdateAction.NEVER as any,
  });
}

export async function exportAndSaveImage(
  api: ExcalidrawImperativeAPI,
  imageUrl: string,
  imageAlt: string | null,
  context: ImageContext,
): Promise<string> {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();

  const blob = await exportToBlob({
    elements: elements as any,
    appState,
    files,
    mimeType: 'image/png',
  });

  const result = await importToAssets(imageUrl, context);
  const baseName = getImageBaseName(result.url, imageAlt);
  const saved = await saveAnnotatedImage(blob, baseName, context);
  return saved.url;
}

export async function saveSceneState(
  ydoc: Y.Doc,
  api: ExcalidrawImperativeAPI,
  context: ImageContext,
): Promise<void> {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();

  const data = JSON.stringify({
    elements,
    appState,
    files,
    version: Date.now(),
  });

  await saveEditingState(context.documentId, data, context);
}

export async function loadSceneState(
  api: ExcalidrawImperativeAPI,
  context: ImageContext,
): Promise<boolean> {
  const data = await loadEditingState(context.documentId, context);
  if (!data) return false;

  try {
    const parsed = JSON.parse(data);
    if (parsed.files) {
      const entries = Object.values(parsed.files).filter(Boolean) as BinaryFileData[];
      if (entries.length > 0) api.addFiles(entries);
    }
    if (parsed.elements) {
      (api as any).updateScene({
        elements: parsed.elements,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function clearSceneState(
  ydoc: Y.Doc,
  context: ImageContext,
): Promise<void> {
  const map = ydoc.getMap(EXCALIDRAW_MAP_KEY);
  const filesMap = ydoc.getMap(FILES_MAP_KEY);
  ydoc.transact(() => {
    map.delete('elements');
    map.delete('appState');
    map.delete('version');
    map.delete('files');
    filesMap.clear();
  }, ydoc.clientID);

  await deleteEditingState(context.documentId, context);
}

export function getContextFromYdoc(ydoc: Y.Doc, isCloud: boolean, teamId?: string, uid?: string): ImageContext {
  const filePath = ydoc.getMap('meta').get('file_path') as string | undefined;
  const docDir = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) : undefined;
  const documentId = ydoc.guid;
  return { docDir, documentId, isCloud, teamId, uid };
}

export function getContextFromDocumentId(
  documentId: string,
  filePath?: string,
  isCloud: boolean = false,
  teamId?: string,
  uid?: string,
): ImageContext {
  const docDir = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) : undefined;
  return { docDir, documentId, isCloud, teamId, uid };
}
