import React, { useState } from 'react';
import { ArrowUpRight, Check, Loader2 } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '../filesystem/tauriCommands';
import { PUBLISH_TYPE_INFO, THEME_DOCS_URL, type PublishType, type ThemeOption } from './publishTypes';

interface StepThemeProps {
  themes: ThemeOption[];
  loading: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  type: PublishType;
}

/** Step two: which theme renders it. */
export function StepTheme({ themes, loading, selected, onSelect, type }: StepThemeProps) {
  if (loading) {
    return (
      <p className="publish__status">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading themes…
      </p>
    );
  }

  return (
    <>
      {themes.length === 0 ? (
        <p className="publish__status">
          No themes are available for {PUBLISH_TYPE_INFO[type].title.toLowerCase()} yet.
        </p>
      ) : (
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {themes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              type={type}
              selected={selected === theme.id}
              onSelect={() => onSelect(theme.id)}
            />
          ))}
        </div>
      )}

      <div className="theme-authoring">
        <div>
          <p className="theme-authoring__title">Want a theme that isn't here?</p>
          <p className="theme-authoring__body">
            Themes are plain Zola templates. Build one, then open a pull request against the themes
            repository to have it shipped with the app.
          </p>
        </div>
        <button
          type="button"
          className="theme-authoring__link"
          onClick={() => void invoke('open_browser_url', { url: THEME_DOCS_URL })}
        >
          Read the guide <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </>
  );
}

interface ThemeCardProps {
  theme: ThemeOption;
  type: PublishType;
  selected: boolean;
  onSelect: () => void;
}

function ThemeCard({ theme, type, selected, onSelect }: ThemeCardProps) {
  // A screenshot that fails to load falls back to the wireframe rather than
  // leaving a broken image in the grid.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(theme.screenshot) && !imageFailed;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className="theme-card"
      data-selected={selected}
      onClick={onSelect}
    >
      <span className="theme-card__preview">
        {showImage ? (
          <img
            src={convertFileSrc(theme.screenshot as string)}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <ThemeWireframe type={type} />
        )}
        {selected && (
          <span className="theme-card__check">
            <Check className="w-3.5 h-3.5" />
          </span>
        )}
      </span>

      <span className="theme-card__body">
        <span className="theme-card__head">
          <span className="theme-card__name">{theme.name}</span>
          {theme.author && <span className="theme-card__author">by {theme.author}</span>}
        </span>
        <span className="theme-card__description">
          {theme.description || 'No description provided.'}
        </span>
      </span>
    </button>
  );
}

/**
 * Stand-in for a theme that ships no screenshot — a rough sketch of the layout
 * the project type produces, so the grid stays even and an undecorated theme
 * never looks broken.
 */
function ThemeWireframe({ type }: { type: PublishType }) {
  return (
    <span className="wireframe" data-layout={type} aria-hidden="true">
      {type === 'docs' && (
        <>
          <span className="wireframe__sidebar" />
          <span className="wireframe__main">
            <span className="wireframe__title" />
            <span className="wireframe__line" />
            <span className="wireframe__line" />
            <span className="wireframe__line wireframe__line--short" />
          </span>
        </>
      )}
      {type === 'blog' && (
        <span className="wireframe__grid">
          <span className="wireframe__card" />
          <span className="wireframe__card" />
          <span className="wireframe__card" />
          <span className="wireframe__card" />
        </span>
      )}
      {type === 'book' && (
        <span className="wireframe__main wireframe__main--centered">
          <span className="wireframe__title" />
          <span className="wireframe__line" />
          <span className="wireframe__line" />
          <span className="wireframe__line" />
          <span className="wireframe__line wireframe__line--short" />
        </span>
      )}
      {type === 'slide' && (
        <span className="wireframe__deck">
          <span className="wireframe__title" />
          <span className="wireframe__line wireframe__line--short" />
        </span>
      )}
      {type === 'wiki' && (
        <>
          <span className="wireframe__main">
            <span className="wireframe__title" />
            <span className="wireframe__line" />
            <span className="wireframe__line wireframe__line--short" />
          </span>
          <span className="wireframe__aside">
            <span className="wireframe__line wireframe__line--short" />
            <span className="wireframe__line" />
            <span className="wireframe__line" />
          </span>
        </>
      )}
      {type === 'portfolio' && (
        <span className="wireframe__grid wireframe__grid--tall">
          <span className="wireframe__card" />
          <span className="wireframe__card" />
        </span>
      )}
      {type === 'changelog' && (
        <span className="wireframe__main">
          <span className="wireframe__stack">
            <span className="wireframe__pill" />
            <span className="wireframe__line" />
          </span>
          <span className="wireframe__stack">
            <span className="wireframe__pill" />
            <span className="wireframe__line" />
          </span>
        </span>
      )}
      {type === 'kb' && (
        <span className="wireframe__main">
          <span className="wireframe__search" />
          <span className="wireframe__grid">
            <span className="wireframe__card" />
            <span className="wireframe__card" />
          </span>
        </span>
      )}
    </span>
  );
}
