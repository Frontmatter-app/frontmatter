import React from 'react';
import { LeftSidebar } from './LeftSidebar';
import { CenterColumn } from './CenterColumn';
import { RightSidebar } from './RightSidebar';
import { TitleBar } from '../components/TitleBar';
import { SidebarProvider } from './SidebarContext';
import { useChromeStore } from './chromeStore';

export function DesktopLayout() {
  const leftVisible = useChromeStore((state) => state.leftSidebarVisible);
  const rightVisible = useChromeStore((state) => state.rightSidebarVisible);

  return (
    <div className="flex-1 flex flex-col overflow-hidden w-full bg-[var(--editor-secondary-bg)] text-[var(--editor-text-color)]" style={{ transition: 'background-color 0.3s ease, color 0.3s ease' }}>
      <TitleBar />
      <div className="flex-1 flex overflow-hidden w-full">
        <SidebarProvider>
          {leftVisible && (
            <div data-sidebar="left" className="w-[15rem] flex-shrink-0 flex flex-col" style={{ transition: 'background-color 0.3s ease, opacity 0.35s ease' }}>
              <LeftSidebar className="w-full flex-1 flex flex-col" style={{ transition: 'background-color 0.3s ease' }} />
            </div>
          )}
          <CenterColumn className="flex-1 flex flex-col min-w-0 min-h-0" style={{ transition: 'background-color 0.3s ease' }} />
          {rightVisible && (
            <div data-sidebar="right" className="w-[15rem] flex-shrink-0 flex flex-col" style={{ transition: 'background-color 0.3s ease, opacity 0.35s ease' }}>
              <RightSidebar className="w-full flex-1 flex flex-col" style={{ transition: 'background-color 0.3s ease' }} />
            </div>
          )}
        </SidebarProvider>
      </div>
    </div>
  );
}
