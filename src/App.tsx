import React, { useState, useEffect } from 'react';
import { AuthProvider } from './auth/AuthProvider';
import { PlanProvider } from './billing/PlanProvider';
import { WorkspaceProvider, useWorkspace } from './workspace/WorkspaceProvider';
import { DesktopLayout } from './layout/DesktopLayout';

import { useSettingsStore } from './settings/settingsStore';
import { SettingsModal } from './settings/SettingsModal';
import { ActivityMonitorModal } from './components/ActivityMonitorModal';
import { UpgradeModal } from './billing/UpgradeModal.tsx';
import { AgreementGate } from './components/AgreementGate';
import { InviteLandingScreen } from './components/InviteLandingScreen';
import { PromptDialog } from './components/PromptDialog';
import { ExcalidrawModal } from './excalidraw/ExcalidrawModal';
import { useProductivityTracker } from './settings/metrics/useProductivityTracker';


function MainApp() {
  const { isInitializing } = useWorkspace();
  const { settings } = useSettingsStore();
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  
  // Track writing productivity in the background
  useProductivityTracker();

  useEffect(() => {
    const handleOpen = () => setIsActivityOpen(true);
    const handleClose = () => setIsActivityOpen(false);
    window.addEventListener('open-activity-monitor', handleOpen);
    window.addEventListener('close-activity-monitor', handleClose);
    return () => {
      window.removeEventListener('open-activity-monitor', handleOpen);
      window.removeEventListener('close-activity-monitor', handleClose);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('toggle-focus-mode'));
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

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
      <SettingsModal />
      <ActivityMonitorModal isOpen={isActivityOpen} onClose={() => setIsActivityOpen(false)} />
      <UpgradeModal />
      <AgreementGate />
      <InviteLandingScreen />
      <PromptDialog />
      <ExcalidrawModal />
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
