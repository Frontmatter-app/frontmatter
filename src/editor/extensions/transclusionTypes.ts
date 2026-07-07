export interface ResolvedObject {
  uuid: string;
  object_type: string;
  name: string;
  content?: string;
  source_path: string;
  start_line: number;
  content_hash: string;
  transclusion_hash?: string;
}

export interface TransclusionRange {
  type: 'ref' | 'exec';
  uuid: string;
  startPos: number;
  endPos: number;
  startLine: number;
  endLine: number;
}

export function mapToResolvedObject(uuid: string, wsObj: any): ResolvedObject {
  let objectType = 'Unknown';
  if (wsObj.object_type) {
    if (typeof wsObj.object_type === 'string') {
      objectType = wsObj.object_type;
    } else if (typeof wsObj.object_type === 'object' && wsObj.object_type.type) {
      objectType = wsObj.object_type.type;
    }
  }
  return {
    uuid: wsObj.uuid || uuid,
    object_type: objectType,
    name: wsObj.name || '',
    content: wsObj.content || '',
    source_path: wsObj.document_path || '',
    start_line: wsObj.start_line || 0,
    content_hash: wsObj.content_hash || '',
    transclusion_hash: wsObj.transclusion_hash || undefined,
  };
}
