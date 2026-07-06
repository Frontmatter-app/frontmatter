import React from 'react';
import { User } from '../types';

interface ActiveAccountCardProps {
  user: User;
  planLabel: string;
}

export function ActiveAccountCard({ user, planLabel }: ActiveAccountCardProps) {
  return (
    <div
      className="mb-4 p-3 rounded-xl flex items-center gap-2.5"
      style={{
        border: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 6%, transparent)',
        background: 'color-mix(in srgb, var(--editor-bg-color, #0d1117) 50%, transparent)',
      }}
    >
      {user.avatar_url ? (
        <img
          src={user.avatar_url}
          alt={user.display_name}
          className="w-8 h-8 rounded-full object-cover"
          style={{ border: '1px solid color-mix(in srgb, var(--editor-text-color, #fff) 10%, transparent)' }}
        />
      ) : (
        <div
          className="w-8 h-8 rounded-full font-bold flex items-center justify-center text-xs"
          style={{
            background: 'var(--editor-secondary-bg, #161b22)',
            color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 70%, transparent)',
          }}
        >
          {user.display_name?.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div
          className="text-xs font-semibold flex items-center gap-1.5"
          style={{ color: 'var(--editor-text-color, #c9d1d9)' }}
        >
          <span className="truncate">{user.display_name}</span>
          <span
            className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase"
            style={{
              border: '1px solid color-mix(in srgb, var(--editor-link-color, #58a6ff) 25%, transparent)',
              background: 'color-mix(in srgb, var(--editor-link-color, #58a6ff) 12%, transparent)',
              color: 'var(--editor-link-color, #58a6ff)',
            }}
          >
            {planLabel}
          </span>
        </div>
        <div
          className="text-[10px] truncate mt-0.5"
          style={{ color: 'color-mix(in srgb, var(--editor-text-color, #c9d1d9) 45%, transparent)' }}
        >
          {user.email}
        </div>
      </div>
    </div>
  );
}
