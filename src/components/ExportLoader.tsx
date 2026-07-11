import React from 'react';

export function ExportLoader() {
  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 animate-fade-in"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--editor-bg-color, #000) 75%, transparent)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="w-10 h-10 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm font-medium opacity-80">Generating project export...</p>
    </div>
  );
}
