import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataProvider } from './DataProvider';
import { createFakePorts } from './fakes';
import { useTeam, useTeamNames } from './hooks';
import type { DataPorts } from './ports';

function wrapperFor(ports: DataPorts) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <DataProvider ports={ports}>{children}</DataProvider>;
  };
}

describe('data hooks', () => {
  it('loads a team without any Firebase connection', async () => {
    const ports = createFakePorts({
      teams: [{ id: 't1', name: 'Docs Team', ownerId: 'u1', members: ['u2'] }],
    });

    const { result } = renderHook(() => useTeam('t1'), { wrapper: wrapperFor(ports) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.value?.name).toBe('Docs Team');
    expect(result.current.error).toBeNull();
  });

  it('stays idle when no team is selected', () => {
    const ports = createFakePorts();
    const { result } = renderHook(() => useTeam(null), { wrapper: wrapperFor(ports) });

    expect(result.current.value).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('reports a team that does not exist as absent, not as an error', async () => {
    const ports = createFakePorts();
    const { result } = renderHook(() => useTeam('missing'), { wrapper: wrapperFor(ports) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.value).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('resolves team names sorted alphabetically', async () => {
    const ports = createFakePorts({
      teams: [
        { id: 't1', name: 'Zebra', ownerId: 'u1', members: [] },
        { id: 't2', name: 'Alpha', ownerId: 'u1', members: [] },
      ],
    });

    const { result } = renderHook(() => useTeamNames(['t1', 't2']), {
      wrapper: wrapperFor(ports),
    });

    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current.map((t) => t.name)).toEqual(['Alpha', 'Zebra']);
  });

  it('keeps a row for a team it cannot read', async () => {
    const ports = createFakePorts({
      teams: [{ id: 't1', name: 'Real', ownerId: 'u1', members: [] }],
    });

    const { result } = renderHook(() => useTeamNames(['t1', 'gone']), {
      wrapper: wrapperFor(ports),
    });

    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current.map((t) => t.name)).toEqual(['Real', 'Unnamed Team']);
  });

  it('clears names when disabled', async () => {
    const ports = createFakePorts({
      teams: [{ id: 't1', name: 'Real', ownerId: 'u1', members: [] }],
    });

    const { result } = renderHook(({ open }) => useTeamNames(['t1'], open), {
      wrapper: wrapperFor(ports),
      initialProps: { open: true },
    });

    await waitFor(() => expect(result.current).toHaveLength(1));
  });
});
