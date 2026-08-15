import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { referencedAssetNames } from './assetGc';

function docWith(markdown: string, draft = '') {
  const doc = new Y.Doc();
  doc.getText('markdown').insert(0, markdown);
  if (draft) doc.getText('draft').insert(0, draft);
  return doc;
}

describe('referencedAssetNames', () => {
  it('finds local and remote references alike', () => {
    const doc = docWith(
      '![one](./.assets/imgs/a-1234abcd.webp)\n![two](https://cdn.example.com/assets/deadbeef.webp)\n',
    );

    expect(referencedAssetNames(doc)).toEqual(
      new Set(['a-1234abcd.webp', 'deadbeef.webp']),
    );
  });

  it('ignores query strings and fragments', () => {
    const doc = docWith('![x](./.assets/imgs/a-1234abcd.webp?v=2#top)');
    expect(referencedAssetNames(doc)).toContain('a-1234abcd.webp');
  });

  it('decodes percent-encoded names so they match the file on disk', () => {
    const doc = docWith('![x](./.assets/imgs/my%20photo.webp)');
    expect(referencedAssetNames(doc)).toContain('my photo.webp');
  });

  it('covers the draft outline as well as the prose', () => {
    const doc = docWith('![a](./.assets/imgs/a.webp)', '![b](./.assets/imgs/b.webp)');
    expect(referencedAssetNames(doc)).toEqual(new Set(['a.webp', 'b.webp']));
  });

  it('counts drawing scene images as referenced', () => {
    // Scene images are references now rather than embedded base64, so they must
    // be visible to the sweep or a drawing's images would be collected.
    const doc = docWith('no images here');
    const files = doc.getMap<any>('excalidraw-files');
    files.set('file1', { assetRef: 'https://cdn.example.com/assets/scene1.webp' });

    expect(referencedAssetNames(doc)).toContain('scene1.webp');
  });

  it('returns nothing for a document with no images', () => {
    expect(referencedAssetNames(docWith('# Just prose\n\nNo pictures.'))).toEqual(new Set());
  });

  it('does not mistake a link for an image', () => {
    const doc = docWith('[a link](./.assets/imgs/not-an-image.webp)');
    expect(referencedAssetNames(doc)).toEqual(new Set());
  });
});
