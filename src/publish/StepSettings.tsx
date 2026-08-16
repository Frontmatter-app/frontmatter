import React from 'react';
import { DsInput, DsTextarea, DsToggle } from '../design/components';
import type { ConfigValues, ThemeOption, ThemeOptionField } from './publishTypes';

interface StepSettingsProps {
  values: ConfigValues | null;
  theme: ThemeOption | null;
  path: string;
  onChange: (values: ConfigValues) => void;
}

/**
 * Step three: the workspace's `config.yml`, value by value.
 *
 * Keys are shown but never editable. The exporter, the themes, and the
 * generated `config.toml` all key off these names, so renaming or removing one
 * breaks the site — but the values behind them are exactly what a user needs
 * to change. Every key present in the file is listed, including any the app
 * itself does not model.
 */
export function StepSettings({ values, theme, path, onChange }: StepSettingsProps) {
  if (!values) {
    return <p className="publish__status">Loading settings…</p>;
  }

  const keys = Object.keys(values);
  // A theme declares fields for the keys it reads out of `custom:`, not for
  // the top-level settings, so the labels attach one level down.
  const declared = new Map((theme?.options ?? []).map((o) => [o.key, o]));

  const setKey = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  return (
    <div className="settings">
      <p className="settings__path">
        Editing <code>{path}</code>
      </p>

      {keys.length === 0 ? (
        <p className="publish__status">This config is empty.</p>
      ) : (
        <dl className="settings__list">
          {keys.map((key) => (
            <ValueRow
              key={key}
              name={key}
              value={values[key]}
              childFields={key === 'custom' ? declared : undefined}
              onChange={(next) => setKey(key, next)}
            />
          ))}
        </dl>
      )}
    </div>
  );
}

type FieldMap = Map<string, ThemeOptionField>;

interface ValueRowProps {
  name: string;
  value: unknown;
  /** Metadata for this row's own value. */
  field?: ThemeOptionField;
  /** Metadata for the keys inside this row, when its value is a map. */
  childFields?: FieldMap;
  /** Nested rows indent and drop the section styling. */
  nested?: boolean;
  onChange: (value: unknown) => void;
}

function ValueRow({ name, value, field, childFields, nested, onChange }: ValueRowProps) {
  const label = field?.label || humanize(name);
  const help = field?.help ?? HELP[name];
  const id = `config-${name}`;

  return (
    <div className="settings__row" data-nested={nested ? 'true' : undefined}>
      <dt className="settings__key">
        <label htmlFor={id}>{label}</label>
        <code>{name}</code>
      </dt>
      <dd className="settings__value">
        <ValueEditor
          id={id}
          name={name}
          label={label}
          value={value}
          field={field}
          childFields={childFields}
          onChange={onChange}
        />
        {help && <span className="ds-hint">{help}</span>}
      </dd>
    </div>
  );
}

interface ValueEditorProps {
  id: string;
  name: string;
  label: string;
  value: unknown;
  field?: ThemeOptionField;
  childFields?: FieldMap;
  onChange: (value: unknown) => void;
}

/** Picks a control from the value's own shape, so the type is never changed. */
function ValueEditor({ id, name, label, value, field, childFields, onChange }: ValueEditorProps) {
  if (typeof value === 'boolean' || field?.type === 'boolean') {
    return <DsToggle checked={Boolean(value)} onChange={onChange} label={label} />;
  }

  if (typeof value === 'number') {
    return (
      <DsInput
        id={id}
        type="number"
        value={String(value)}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    );
  }

  if (Array.isArray(value)) {
    // One entry per line. `order` can run to hundreds of paths, which no
    // row-per-entry editor stays usable at.
    return (
      <>
        <DsTextarea
          id={id}
          className="settings__lines"
          spellCheck={false}
          rows={Math.min(Math.max(value.length, 2), 10)}
          value={value.map(String).join('\n')}
          onChange={(e) =>
            onChange(
              e.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            )
          }
        />
        <span className="ds-hint">
          {value.length} {value.length === 1 ? 'entry' : 'entries'}, one per line
        </span>
      </>
    );
  }

  if (value && typeof value === 'object') {
    const nested = value as Record<string, unknown>;
    const nestedKeys = Object.keys(nested);

    if (nestedKeys.length === 0) {
      return <span className="settings__empty">Nothing set.</span>;
    }
    return (
      <dl className="settings__nested">
        {nestedKeys.map((key) => (
          <ValueRow
            key={key}
            name={key}
            value={nested[key]}
            field={childFields?.get(key)}
            nested
            onChange={(next) => onChange({ ...nested, [key]: next })}
          />
        ))}
      </dl>
    );
  }

  const text = value == null ? '' : String(value);
  const multiline = field?.type === 'textarea' || LONG_KEYS.has(name);

  const commit = (raw: string) => {
    // An emptied field that started as null stays null rather than becoming an
    // empty string, so the file does not gain noise from being looked at.
    onChange(raw === '' && value == null ? null : raw);
  };

  if (multiline) {
    return (
      <DsTextarea id={id} rows={2} value={text} onChange={(e) => commit(e.target.value)} />
    );
  }

  return (
    <DsInput
      id={id}
      type={field?.type === 'color' ? 'color' : 'text'}
      value={text}
      onChange={(e) => commit(e.target.value)}
    />
  );
}

/** `base_url` -> `Base URL`. */
function humanize(key: string): string {
  return key
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) =>
      word.toLowerCase() === 'url' ? 'URL' : word[0].toUpperCase() + word.slice(1),
    )
    .join(' ');
}

const LONG_KEYS = new Set(['description']);

/** Explanations for the keys the exporter itself reads. */
const HELP: Record<string, string> = {
  title: 'Shown in the site header and browser tab.',
  author: 'Shown in the footer.',
  description: 'One line about the site.',
  base_url: 'Leave as / unless the site is deployed under a subpath.',
  theme: 'Set by the theme step. Changing it here picks a different theme.',
  index_page: "The document used as the site's home page.",
  order: 'Document order in the built site.',
  exclude: 'Documents left out of the build entirely.',
  excerpt: 'Per-document summary overrides.',
  custom: 'Passed to templates as config.extra.<key>.',
};
