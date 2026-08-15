import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, ChevronDown, Clock } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FontPickerProps {
  value: string;
  onChange: (fontFamily: string) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LAST_USED_KEY = 'frontmatter_last_used_fonts';
const MAX_LAST_USED = 5;

/** Curated fallback font list used when queryLocalFonts() is unavailable. */
const FALLBACK_FONTS = [
  'Arial',
  'Arial Black',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Impact',
  'Inter',
  'JetBrains Mono',
  'Lato',
  'Merriweather',
  'Montserrat',
  'Open Sans',
  'Oswald',
  'Playfair Display',
  'Poppins',
  'PT Mono',
  'PT Serif',
  'Raleway',
  'Roboto',
  'Roboto Mono',
  'Source Code Pro',
  'Source Sans 3',
  'Times New Roman',
  'Trebuchet MS',
  'Ubuntu',
  'Verdana',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a CSS font-family value like `"Inter", sans-serif` → `Inter` */
function parsePrimaryFont(cssValue: string): string {
  const cleaned = cssValue.trim();
  const match = cleaned.match(/^["']?([^"',]+)["']?/);
  return match ? match[1].trim() : cleaned;
}

/** Format a plain font name back to a CSS font-family string */
function toCssFontFamily(name: string): string {
  if (name.includes(' ')) {
    return `"${name}", sans-serif`;
  }
  return `${name}, sans-serif`;
}

function loadLastUsed(): string[] {
  try {
    const raw = localStorage.getItem(LAST_USED_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch { /* ignore */ }
  return [];
}

function saveLastUsed(fonts: string[]) {
  try {
    localStorage.setItem(LAST_USED_KEY, JSON.stringify(fonts));
  } catch { /* ignore */ }
}

function addToLastUsed(fontName: string, current: string[]): string[] {
  const filtered = current.filter(f => f !== fontName);
  return [fontName, ...filtered].slice(0, MAX_LAST_USED);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FontPicker({ value, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [allFonts, setAllFonts] = useState<string[]>([]);
  const [lastUsed, setLastUsed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const currentName = parsePrimaryFont(value);

  // ── Load system fonts on mount ─────────────────────────────────────────────
  useEffect(() => {
    setLastUsed(loadLastUsed());

    const load = async () => {
      try {
        // Ask the Rust backend for all fonts from the macOS font directories
        const fonts = await invoke<string[]>('get_system_fonts');
        if (fonts && fonts.length > 0) {
          setAllFonts(fonts); // already sorted by the Rust side
        } else {
          setAllFonts(FALLBACK_FONTS);
        }
      } catch {
        setAllFonts(FALLBACK_FONTS);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  // ── Close on outside click ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ── Focus search on open ───────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  // ── Keyboard navigation ────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setSearch('');
    }
  }, []);

  // ── Font selection ─────────────────────────────────────────────────────────
  const selectFont = useCallback((fontName: string) => {
    const updated = addToLastUsed(fontName, lastUsed);
    setLastUsed(updated);
    saveLastUsed(updated);
    onChange(toCssFontFamily(fontName));
    setOpen(false);
    setSearch('');
  }, [lastUsed, onChange]);

  // ── Filtered list ──────────────────────────────────────────────────────────
  const q = search.toLowerCase().trim();
  const filtered = q
    ? allFonts.filter(f => f.toLowerCase().includes(q))
    : allFonts;

  // Last used filtered by search
  const visibleLastUsed = q
    ? lastUsed.filter(f => f.toLowerCase().includes(q))
    : lastUsed;

  // All fonts excluding ones already shown in last-used section
  const mainList = filtered.filter(f => !visibleLastUsed.includes(f));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 py-1.5 px-3 text-xs bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl outline-none hover:bg-black/10 dark:hover:bg-white/10 transition-all cursor-pointer min-w-[180px] justify-between select-none"
        style={{ fontFamily: value }}
      >
        <span className="truncate max-w-[140px]">{currentName || 'Select font…'}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 opacity-50 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute z-50 mt-1.5 right-0 w-72 rounded-2xl border border-black/10 dark:border-white/10 shadow-2xl overflow-hidden"
          style={{
            background: 'var(--editor-bg-color, #fff)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}
        >
          {/* Search bar */}
          <div className="px-3 pt-3 pb-2 border-b border-black/5 dark:border-white/5">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-black/5 dark:bg-white/5 border border-black/8 dark:border-white/8">
              <Search className="w-3.5 h-3.5 opacity-40 flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search fonts…"
                className="flex-1 bg-transparent outline-none text-xs placeholder:opacity-40"
                style={{ color: 'var(--editor-text-color)' }}
              />
            </div>
          </div>

          {/* Font list */}
          <ul
            ref={listRef}
            className="overflow-y-auto"
            style={{ maxHeight: '260px' }}
          >
            {loading && (
              <li className="px-4 py-6 text-center text-xs opacity-40">
                Loading fonts…
              </li>
            )}

            {!loading && visibleLastUsed.length > 0 && (
              <>
                {/* Last used header */}
                <li className="px-3 pt-2.5 pb-1 flex items-center gap-1.5 opacity-50">
                  <Clock className="w-3 h-3" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">Recent</span>
                </li>

                {visibleLastUsed.map(font => (
                  <FontItem
                    key={`recent-${font}`}
                    font={font}
                    selected={font === currentName}
                    onSelect={selectFont}
                  />
                ))}

                {/* Divider */}
                <li
                  className="mx-3 my-1 border-t border-black/5 dark:border-white/5"
                  aria-hidden="true"
                />
              </>
            )}

            {!loading && mainList.length === 0 && visibleLastUsed.length === 0 && (
              <li className="px-4 py-6 text-center text-xs opacity-40">
                No fonts match &ldquo;{search}&rdquo;
              </li>
            )}

            {!loading && mainList.map(font => (
              <FontItem
                key={font}
                font={font}
                selected={font === currentName}
                onSelect={selectFont}
              />
            ))}
          </ul>

          {/* Footer hint */}
          {!loading && allFonts.length > 0 && (
            <div className="px-3 py-2 border-t border-black/5 dark:border-white/5 text-[10px] opacity-35 text-center">
              {allFonts.length} fonts available
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── FontItem ─────────────────────────────────────────────────────────────────

interface FontItemProps {
  key?: React.Key;
  font: string;
  selected: boolean;
  onSelect: (font: string) => void;
}

function FontItem({ font, selected, onSelect }: FontItemProps) {
  const itemRef = useRef<HTMLLIElement>(null);

  // Scroll selected item into view when dropdown opens
  useEffect(() => {
    if (selected && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  return (
    <li
      ref={itemRef}
      onClick={() => onSelect(font)}
      className={`px-3 py-2 flex items-center justify-between gap-2 cursor-pointer transition-colors text-xs select-none mx-1 rounded-xl my-0.5 ${
        selected
          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
          : 'hover:bg-black/5 dark:hover:bg-white/5'
      }`}
      style={{ color: selected ? undefined : 'var(--editor-text-color)' }}
    >
      <span className="truncate" style={{ fontFamily: `"${font}", sans-serif` }}>
        {font}
      </span>
      {/* Preview label rendered in the font itself */}
      <span
        className="opacity-40 text-[11px] flex-shrink-0"
        style={{ fontFamily: `"${font}", sans-serif` }}
      >
        Aa
      </span>
    </li>
  );
}
