import React from 'react';
import { LeftSidebar } from './LeftSidebar';
import { CenterColumn } from './CenterColumn';
import { RightSidebar } from './RightSidebar';
import { TitleBar } from '../components/TitleBar';

export function DesktopLayout() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden w-full bg-[var(--editor-secondary-bg)] text-[var(--editor-text-color)]" style={{ transition: 'background-color 0.3s ease, color 0.3s ease' }}>
      <TitleBar />
      <div className="flex-1 flex overflow-hidden w-full">
        <div data-sidebar="left" className="w-[15rem] flex-shrink-0 flex flex-col" style={{ transition: 'background-color 0.3s ease, opacity 0.35s ease' }}>
          <LeftSidebar className="w-full flex-1 flex flex-col" style={{ transition: 'background-color 0.3s ease' }} />
        </div>
        <CenterColumn className="flex-1 flex flex-col min-w-0 min-h-0" style={{ transition: 'background-color 0.3s ease' }} />
        <div data-sidebar="right" className="w-[15rem] flex-shrink-0 flex flex-col" style={{ transition: 'background-color 0.3s ease, opacity 0.35s ease' }}>
          <RightSidebar className="w-full flex-1 flex flex-col" style={{ transition: 'background-color 0.3s ease' }} />
        </div>
      </div>
    </div>
  );
}
