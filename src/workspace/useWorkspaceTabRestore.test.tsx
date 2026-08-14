import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activeStorageKey, tabsStorageKey, useWorkspaceTabRestore } from './useWorkspaceTabRestore';
import type { DocumentMeta } from '../types';

const doc = (id: string, extra: Partial<DocumentMeta> = {}): DocumentMeta => ({
  id,
  title: id,
  content: '',
  stage: 'write',
  focus_mode: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  word_count: 0,
  ...extra,
});

/** Drives the hook and reports the tab state it produces. */
function Harness({ workspacePath, documents, onState }: {
  workspacePath: string | null;
  documents: DocumentMeta[];
  onState: (state: { tabs: string[]; active: string | null }) => void;
}) {
  const [tabs, setTabs] = React.useState<string[]>([]);
  const [active, setActive] = React.useState<string | null>(null);

  useWorkspaceTabRestore({
    workspacePath,
    documents,
    setOpenTabs: setTabs,
    setCurrentDocumentId: setActive,
    refreshDocuments: async () => [],
    refreshDirectoryTree: async () => {},
  });

  React.useEffect(() => { onState({ tabs, active }); });
  return null;
}

describe('useWorkspaceTabRestore', () => {
  beforeEach(() => localStorage.clear());

  it('restores saved tabs once their documents resolve', () => {
    localStorage.setItem(tabsStorageKey('/w'), JSON.stringify(['a', 'b']));
    localStorage.setItem(activeStorageKey('/w'), 'b');

    let state = { tabs: [] as string[], active: null as string | null };
    render(
      <Harness
        workspacePath="/w"
        documents={[doc('a'), doc('b')]}
        onState={next => { state = next; }}
      />,
    );

    expect(state.tabs).toEqual(['a', 'b']);
    expect(state.active).toBe('b');
  });

  it('admits a cloud document that arrives after the first render', () => {
    // The restore used to filter saved ids against the local database alone,
    // so a team member's cloud-only documents were dropped before their
    // Firestore subscription had delivered them.
    localStorage.setItem(tabsStorageKey('/w'), JSON.stringify(['local-1', 'cloud-1']));

    let state = { tabs: [] as string[], active: null as string | null };
    const view = render(
      <Harness workspacePath="/w" documents={[doc('local-1')]} onState={next => { state = next; }} />,
    );
    expect(state.tabs).toEqual(['local-1']);

    act(() => {
      view.rerender(
        <Harness
          workspacePath="/w"
          documents={[doc('local-1'), doc('cloud-1', { is_cloud: true })]}
          onState={next => { state = next; }}
        />,
      );
    });

    expect(state.tabs).toEqual(['local-1', 'cloud-1']);
  });

  it('clears tabs when the window switches workspace', () => {
    // Stale ids belong to another workspace's database. Left open, the loader
    // fell back to Firestore and recreated the row in the new workspace.
    localStorage.setItem(tabsStorageKey('/personal'), JSON.stringify(['a']));

    let state = { tabs: [] as string[], active: null as string | null };
    const view = render(
      <Harness workspacePath="/personal" documents={[doc('a')]} onState={next => { state = next; }} />,
    );
    expect(state.tabs).toEqual(['a']);

    act(() => {
      view.rerender(
        <Harness workspacePath="/team" documents={[doc('a')]} onState={next => { state = next; }} />,
      );
    });

    expect(state.tabs).toEqual([]);
    expect(state.active).toBeNull();
  });

  it('opens nothing when no saved tab ever resolves', () => {
    localStorage.setItem(tabsStorageKey('/w'), JSON.stringify(['ghost']));

    let state = { tabs: [] as string[], active: null as string | null };
    render(<Harness workspacePath="/w" documents={[doc('other')]} onState={next => { state = next; }} />);

    expect(state.tabs).toEqual([]);
    expect(state.active).toBeNull();
  });

  it('falls back to the first tab when the saved active id is gone', () => {
    localStorage.setItem(tabsStorageKey('/w'), JSON.stringify(['a', 'b']));
    localStorage.setItem(activeStorageKey('/w'), 'missing');

    let state = { tabs: [] as string[], active: null as string | null };
    render(<Harness workspacePath="/w" documents={[doc('a'), doc('b')]} onState={next => { state = next; }} />);

    expect(state.active).toBe('a');
  });

  it('discards malformed saved state instead of throwing', () => {
    localStorage.setItem(tabsStorageKey('/w'), '{not json');

    let state = { tabs: [] as string[], active: null as string | null };
    render(<Harness workspacePath="/w" documents={[doc('a')]} onState={next => { state = next; }} />);

    expect(state.tabs).toEqual([]);
    expect(localStorage.getItem(tabsStorageKey('/w'))).toBeNull();
  });

  it('does nothing without a workspace', () => {
    const refreshDocuments = vi.fn(async () => []);
    render(
      <Harness workspacePath={null} documents={[]} onState={() => {}} />,
    );
    expect(refreshDocuments).not.toHaveBeenCalled();
  });
});
