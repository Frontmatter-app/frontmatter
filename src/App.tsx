import React from 'react';
import { AuthProvider } from './auth/AuthProvider';
import { PlanProvider } from './billing/PlanProvider';
import { WorkspaceProvider, useWorkspace } from './workspace/WorkspaceProvider';
import { DesktopLayout } from './layout/DesktopLayout';

import { useSettingsStore } from './settings/settingsStore';
import { createRegistry } from './features/registry';
import { shellFeatures } from './features/shellFeatures';

// Built once at module scope: the manifest is static, so the resolved graph is
// too. `App` imports no feature module directly — removing a feature from the
// manifest removes it from the shell.
const shell = createRegistry<Record<string, unknown>, React.ReactNode>(shellFeatures);
if (shell.skipped.length > 0) {
  console.warn('[features] shell features disabled:', shell.skipped);
}

function MainApp() {
  const { isInitializing } = useWorkspace();
  const { settings } = useSettingsStore();

  if (isInitializing) {
    return (
      <div className="min-h-screen w-screen bg-[var(--editor-secondary-bg)] text-[var(--editor-text-color)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
          <p className="text-sm text-[var(--editor-text-color)] opacity-60 font-medium">Opening account workspace...</p>
        </div>
      </div>
    );
  }

  const iconStyleClass = `icon-style-${settings.iconStyle || 'clean'}`;

  return (
    <div
      className={`min-h-screen h-screen w-screen bg-[var(--editor-secondary-bg)] text-[var(--editor-text-color)] selection:bg-blue-100 flex flex-col overflow-hidden ${iconStyleClass}`}
      style={{
        fontFamily: settings.fontFamily || 'var(--editor-font-family)',
        transition: 'background-color 0.3s ease, color 0.3s ease',
      }}
    >
      <DesktopLayout />
      {shell.surfaces()}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PlanProvider>
        <WorkspaceProvider>
          <MainApp />
        </WorkspaceProvider>
      </PlanProvider>
    </AuthProvider>
  );
}
