import { useState } from 'react';
import type { State } from '../shared/types';
import { defaultAppearance, readAppearance, type Appearance } from '../shared/appearance';

export default function AppearanceSettings({ state }: { state: State }) {
  const [appearance, setAppearance] = useState<Appearance>(() =>
    readAppearance(state.settings.appearance),
  );
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <section className="appearance-settings" aria-labelledby="appearance-heading">
      <h3 id="appearance-heading">Appearance</h3>
      <label className="field-label">
        Background theme
        <select
          value={appearance.theme}
          onChange={(e) =>
            setAppearance({ ...appearance, theme: e.target.value as Appearance['theme'] })
          }
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
      <label className="field-label">
        UI text size (%)
        <input
          type="number"
          min={100}
          max={175}
          step={5}
          value={appearance.uiScale}
          onChange={(e) => setAppearance({ ...appearance, uiScale: Number(e.target.value) })}
        />
      </label>
      <label className="field-label">
        Log and terminal font size (px)
        <input
          type="number"
          min={12}
          max={24}
          value={appearance.logFontSize}
          onChange={(e) => setAppearance({ ...appearance, logFontSize: Number(e.target.value) })}
        />
      </label>
      <p className="muted">
        UI text size enlarges menus, controls and editors. Log size adjusts chat messages, tool
        output, diagnostics and terminal text independently. Save to apply immediately and remember
        after restart.
      </p>
      <div className="appearance-actions">
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await window.desktop.call('preferences:save', { appearance });
              setNotice('Appearance saved.');
              setError('');
            } catch (e) {
              setError(String(e));
              setNotice('');
            } finally {
              setSaving(false);
            }
          }}
        >
          Save appearance
        </button>
        <button
          onClick={() => {
            setAppearance({ ...defaultAppearance });
            setNotice('Default fields restored. Save appearance to apply.');
          }}
        >
          Reset appearance fields
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
