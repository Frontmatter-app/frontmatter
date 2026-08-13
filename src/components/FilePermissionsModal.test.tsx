import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../data/DataProvider';
import { createFakePorts } from '../data/fakes';
import { FilePermissionsModal, isUnrestricted } from './FilePermissionsModal';

const usePlanMock = vi.hoisted(() => vi.fn());
vi.mock('../billing/PlanProvider', () => ({ usePlan: usePlanMock }));

const GROUPS = {
  editors: { name: 'Editors', members: [], permissions: {} as never },
  reviewers: { name: 'Reviewers', members: [], permissions: {} as never },
};

function renderModal(ports = createFakePorts(), onClose = vi.fn()) {
  usePlanMock.mockReturnValue({ teamDoc: { groups: GROUPS } });
  render(
    <DataProvider ports={ports}>
      <FilePermissionsModal docId="doc-1" docTitle="Chapter One" isOpen onClose={onClose} />
    </DataProvider>,
  );
  return { ports, onClose };
}

describe('isUnrestricted', () => {
  it('is true only when nothing is selected', () => {
    expect(isUnrestricted({ visibleTo: [], writableBy: [], revisableBy: [] })).toBe(true);
    expect(isUnrestricted({ visibleTo: ['a'], writableBy: [], revisableBy: [] })).toBe(false);
    expect(isUnrestricted({ visibleTo: [], writableBy: [], revisableBy: ['a'] })).toBe(false);
  });
});

describe('FilePermissionsModal', () => {
  it('names the document it is editing', async () => {
    renderModal();
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('File permissions');
    expect(screen.getByText('Chapter One')).toBeInTheDocument();
  });

  it('says the file is open to everyone when nothing is restricted', async () => {
    renderModal();
    expect(await screen.findByText(/Everyone on the team can see and edit/)).toBeInTheDocument();
  });

  it('offers a switch per group and permission', async () => {
    renderModal();
    expect(await screen.findByRole('switch', { name: 'Editors — Can see' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Reviewers — Can edit' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Editors — Can revise' })).toBeInTheDocument();
  });

  it('loads the stored permissions', async () => {
    const ports = createFakePorts({
      cloudDocuments: [
        {
          id: 'doc-1',
          filePermissions: { visibleTo: ['editors'], writableBy: [], revisableBy: [] },
        },
      ],
    });
    renderModal(ports);

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Editors — Can see' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });

  it('saves the selected groups', async () => {
    const ports = createFakePorts({ cloudDocuments: [{ id: 'doc-1' }] });
    const { onClose } = renderModal(ports);

    fireEvent.click(await screen.findByRole('switch', { name: 'Editors — Can see' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await expect(ports.cloudDocuments.getFilePermissions('doc-1')).resolves.toEqual({
      visibleTo: ['editors'],
      writableBy: [],
      revisableBy: [],
    });
  });

  it('clears the restriction when every group is switched off', async () => {
    const ports = createFakePorts({
      cloudDocuments: [
        {
          id: 'doc-1',
          filePermissions: { visibleTo: ['editors'], writableBy: [], revisableBy: [] },
        },
      ],
    });
    renderModal(ports);

    const toggle = await screen.findByRole('switch', { name: 'Editors — Can see' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));

    await waitFor(() =>
      expect(ports.cloudDocuments.getFilePermissions('doc-1')).resolves.toBeNull(),
    );
  });

  it('surfaces a save failure rather than closing', async () => {
    const ports = createFakePorts({ cloudDocuments: [{ id: 'doc-1' }] });
    ports.cloudDocuments.setFilePermissions = () =>
      Promise.reject(new Error('Permission denied'));
    const { onClose } = renderModal(ports);

    fireEvent.click(await screen.findByRole('switch', { name: 'Editors — Can see' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('explains when the team has no groups', async () => {
    usePlanMock.mockReturnValue({ teamDoc: { groups: {} } });
    render(
      <DataProvider ports={createFakePorts()}>
        <FilePermissionsModal docId="doc-1" isOpen onClose={vi.fn()} />
      </DataProvider>,
    );
    expect((await screen.findAllByText(/no groups yet/)).length).toBeGreaterThan(0);
  });
});
