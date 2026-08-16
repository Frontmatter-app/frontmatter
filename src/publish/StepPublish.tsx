import React from 'react';
import { Check, ExternalLink, FileArchive, FolderOpen, Loader2 } from 'lucide-react';
import { invoke } from '../filesystem/tauriCommands';
import { DsButton } from '../design/components';
import {
  PUBLISH_TYPE_INFO,
  type ConfigValues,
  type PublishResult,
  type PublishType,
  type ThemeOption,
} from './publishTypes';

interface StepPublishProps {
  type: PublishType;
  theme: ThemeOption | null;
  values: ConfigValues | null;
  result: PublishResult | null;
  publishing: boolean;
  zipping: boolean;
  onSaveArchive: () => void;
  onPublishAgain: () => void;
}

/** Step four: confirm what is about to be built, then what was built. */
export function StepPublish({
  type,
  theme,
  values,
  result,
  publishing,
  zipping,
  onSaveArchive,
  onPublishAgain,
}: StepPublishProps) {
  if (result?.success) {
    return (
      <div className="done">
        <span className="done__mark">
          <Check className="w-6 h-6" />
        </span>
        <h3 className="done__title">
          Published {result.page_count} {result.page_count === 1 ? 'page' : 'pages'}
        </h3>
        <p className="done__path">{result.public_dir}</p>

        <div className="done__actions">
          {result.preview_url && (
            <DsButton
              variant="primary"
              onClick={() =>
                void invoke('open_browser_url', { url: result.preview_url as string })
              }
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open in browser
            </DsButton>
          )}
          <DsButton onClick={() => void invoke('reveal_in_folder', { path: result.public_dir })}>
            <FolderOpen className="w-3.5 h-3.5" /> Reveal folder
          </DsButton>
          <DsButton disabled={zipping} onClick={onSaveArchive}>
            {zipping ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <FileArchive className="w-3.5 h-3.5" /> Save as .zip
              </>
            )}
          </DsButton>
          <DsButton onClick={onPublishAgain}>Publish again</DsButton>
        </div>
      </div>
    );
  }

  if (publishing) {
    return (
      <div className="done">
        <span className="done__mark done__mark--busy">
          <Loader2 className="w-6 h-6 animate-spin" />
        </span>
        <h3 className="done__title">Building the site…</h3>
        <p className="done__path">Rendering pages and running the theme templates.</p>
      </div>
    );
  }

  const title = (values?.title as string | undefined) || 'Untitled';

  return (
    <div className="summary">
      <dl className="summary__list">
        <div className="summary__row">
          <dt>Site</dt>
          <dd>{title}</dd>
        </div>
        <div className="summary__row">
          <dt>Type</dt>
          <dd>{PUBLISH_TYPE_INFO[type].title}</dd>
        </div>
        <div className="summary__row">
          <dt>Theme</dt>
          <dd>{theme?.name ?? '—'}</dd>
        </div>
        <div className="summary__row">
          <dt>Address</dt>
          <dd>{(values?.base_url as string | undefined) || '/'}</dd>
        </div>
      </dl>

      <p className="summary__note">
        The site is built on this machine and opened in your browser. Nothing is uploaded — you can
        save it as a <code>.zip</code> afterwards to host it anywhere.
      </p>
    </div>
  );
}
