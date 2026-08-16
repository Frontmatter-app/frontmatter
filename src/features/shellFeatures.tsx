import React, { Suspense, lazy, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { SettingsModal } from '../settings/SettingsModal';
import { ActivityMonitorModal } from '../components/ActivityMonitorModal';
import { AgreementGate } from '../components/AgreementGate';
import { PromptDialog } from '../components/PromptDialog';
import { useProductivityTracker } from '../settings/metrics/useProductivityTracker';
import { useGlobalShortcuts } from '../keyboard/useGlobalShortcuts';
import { useMenuCommands } from '../menu/useMenuCommands';
import type { FeatureContext, FeatureModule } from './types';

type ShellFeature = FeatureModule<FeatureContext, ReactNode>;

/**
 * Surfaces are rendered as a list, so each needs a stable key. Wrapping in a
 * keyed fragment keeps the key off the feature component's own props.
 */
const keyed = (id: string, node: ReactNode): ReactNode => (
  <React.Fragment key={id}>{node}</React.Fragment>
);

/**
 * Excalidraw is by far the heaviest dependency in the app and is only needed
 * once a board is opened, so it is code-split rather than pulled into the
 * initial bundle.
 */
const ExcalidrawModal = lazy(() =>
  import('../excalidraw/ExcalidrawModal').then((m) => ({ default: m.ExcalidrawModal })),
);

/**
 * The activity monitor is opened by a window event rather than by a prop, so
 * the feature owns that wiring instead of leaking it into `App`.
 */
function ActivityMonitorSurface() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const open = () => setIsOpen(true);
    const close = () => setIsOpen(false);
    window.addEventListener('open-activity-monitor', open);
    window.addEventListener('close-activity-monitor', close);
    return () => {
      window.removeEventListener('open-activity-monitor', open);
      window.removeEventListener('close-activity-monitor', close);
    };
  }, []);

  return <ActivityMonitorModal isOpen={isOpen} onClose={() => setIsOpen(false)} />;
}

/**
 * A hook cannot be called conditionally, so a headless feature contributes a
 * component that runs the hook and renders nothing. Removing the feature
 * removes the hook call.
 */
function headless(hook: () => void): () => null {
  return function HeadlessFeature() {
    hook();
    return null;
  };
}

const ProductivityTracker = headless(useProductivityTracker);
const GlobalShortcuts = headless(useGlobalShortcuts);
const MenuCommands = headless(useMenuCommands);

/**
 * Shell-level features: overlays, modals, and headless background behaviour.
 *
 * `App` renders whatever this manifest yields and imports none of these
 * modules directly. Deleting an entry removes the surface and nothing else
 * breaks — enforced by the removal test in `manifest.test.ts`.
 */
export const shellFeatures: ShellFeature[] = [
  {
    id: 'settings',
    name: 'Settings',
    surface: () => keyed('settings', <SettingsModal />),
    selfTest: () => {
      if (typeof SettingsModal !== 'function') throw new Error('SettingsModal missing');
    },
  },
  {
    id: 'activity-monitor',
    name: 'Activity Monitor',
    surface: () => keyed('activity-monitor', <ActivityMonitorSurface />),
    selfTest: () => {
      if (typeof ActivityMonitorModal !== 'function') {
        throw new Error('ActivityMonitorModal missing');
      }
    },
  },
  {
    id: 'agreement-gate',
    name: 'Terms Agreement',
    surface: () => keyed('agreement-gate', <AgreementGate />),
    selfTest: () => {
      if (typeof AgreementGate !== 'function') throw new Error('AgreementGate missing');
    },
  },
  {
    id: 'prompt-dialog',
    name: 'Prompt Dialogs',
    surface: () => keyed('prompt-dialog', <PromptDialog />),
    selfTest: () => {
      if (typeof PromptDialog !== 'function') throw new Error('PromptDialog missing');
    },
  },
  {
    id: 'excalidraw',
    name: 'Excalidraw Boards',
    surface: () =>
      keyed(
        'excalidraw',
        <Suspense fallback={null}>
          <ExcalidrawModal />
        </Suspense>,
      ),
    selfTest: () => {
      // A lazy component is an exotic object, not a function.
      if (!ExcalidrawModal || typeof ExcalidrawModal !== 'object') {
        throw new Error('ExcalidrawModal lazy wrapper missing');
      }
    },
  },
  {
    id: 'productivity-metrics',
    name: 'Productivity Metrics',
    surface: () => keyed('productivity-metrics', <ProductivityTracker />),
    selfTest: () => {
      if (typeof useProductivityTracker !== 'function') {
        throw new Error('useProductivityTracker missing');
      }
    },
  },
  {
    id: 'menu-commands',
    name: 'Application Menu Commands',
    surface: () => keyed('menu-commands', <MenuCommands />),
    selfTest: () => {
      if (typeof useMenuCommands !== 'function') {
        throw new Error('useMenuCommands missing');
      }
    },
  },
  {
    id: 'global-shortcuts',
    name: 'Global Shortcuts',
    surface: () => keyed('global-shortcuts', <GlobalShortcuts />),
    selfTest: () => {
      if (typeof useGlobalShortcuts !== 'function') {
        throw new Error('useGlobalShortcuts missing');
      }
    },
  },
];
