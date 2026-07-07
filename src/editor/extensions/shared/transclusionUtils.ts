import { EditorView } from '@codemirror/view';

export function isCodeBlockObject(objectType: any) {
  return objectType === 'CodeBlock' || objectType?.type === 'CodeBlock';
}

export function buildCodeBlockAttrs(typeObj: any): string {
  let attrs = '';
  if (typeObj.session) attrs += ` session="${typeObj.session}"`;
  if (typeObj.profile) attrs += ` profile="${typeObj.profile}"`;
  if (typeObj.id) attrs += ` id="${typeObj.id}"`;
  if (typeObj.ref_id) attrs += ` ref="${typeObj.ref_id}"`;
  if (typeObj.continue_of) attrs += ` chain=${typeObj.continue_of}`;
  if (typeObj.before_line != null) attrs += ` before=${typeObj.before_line}`;
  if (typeObj.after_line != null) attrs += ` after=${typeObj.after_line}`;
  return attrs;
}

export function buildRefContent(wsObj: any): string {
  const content = wsObj.content || '';
  if (isCodeBlockObject(wsObj.object_type)) {
    const typeObj = wsObj.object_type;
    const lang = typeObj.language || 'text';
    const attrs = buildCodeBlockAttrs(typeObj);
    return `\n<!-- ref: ${wsObj.uuid} -->\n\`\`\`${lang}${attrs}\n${content}\n\`\`\`\n<!-- /ref -->\n`;
  }
  return `\n<!-- ref: ${wsObj.uuid} -->\n${content}\n<!-- /ref -->\n`;
}

export function buildExecContent(uuid: string, outputText: string): string {
  return `\n<!-- exec: ${uuid} -->\n\`\`\`text\n${outputText.trim()}\n\`\`\`\n<!-- /exec -->\n`;
}

export function replaceTransclusionBlock(view: EditorView, uuid: string, newContent: string) {
  const docText = view.state.doc.toString();
  const startRegex = new RegExp(`<!--\\s*(ref|exec):\\s*${uuid}\\s*-->`);
  const startMatch = startRegex.exec(docText);
  if (!startMatch) {
    console.error('Could not find start tag for transclusion:', uuid);
    return;
  }

  const type = startMatch[1];
  const endRegex = new RegExp(`<!--\\s*/${type}\\s*-->`);
  endRegex.lastIndex = startMatch.index + startMatch[0].length;
  const endMatch = endRegex.exec(docText);
  if (!endMatch) {
    console.error('Could not find end tag for transclusion:', uuid);
    return;
  }

  const from = startMatch.index;
  const to = endMatch.index + endMatch[0].length;

  view.dispatch({
    changes: { from, to, insert: newContent },
  });
}
