import { useState } from 'react';
import type { State } from '../shared/types';
import { defaultAppearance, readAppearance, type Appearance } from '../shared/appearance';
import { languages, t, type Language } from '../shared/i18n';

export default function AppearanceSettings({ state }: { state: State }) {
  const [appearance, setAppearance] = useState<Appearance>(() =>
    readAppearance(state.settings.appearance),
  );
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [language, setLanguage] = useState<Language>(state.settings.language ?? 'en');
  return (
    <section className="appearance-settings" aria-labelledby="appearance-heading">
      <h3 id="appearance-heading">{t('Appearance')}</h3>
      <label className="field-label">
        {t('Interface language')}
        <select
          aria-label={t('Interface language')}
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
        >
          {Object.entries(languages).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        {t(
          'Navigation and common controls are translated locally. Engine output, prompts, diagnostics and advanced configuration retain their original language.',
        )}
      </p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={appearance.followSystem ?? false}
          onChange={(e) => setAppearance({ ...appearance, followSystem: e.target.checked })}
        />
        {t('Follow system theme')}
      </label>
      <label className="field-label">
        {t('Background theme')}
        <select
          value={appearance.theme}
          onChange={(e) =>
            setAppearance({ ...appearance, theme: e.target.value as Appearance['theme'] })
          }
        >
          <option value="dark">{t('Dark')}</option>
          <option value="light">{t('Light')}</option>
        </select>
      </label>
      <label className="field-label">
        {t('Accent color')}
        <select
          aria-label={t('Accent color')}
          value={appearance.accent ?? 'green'}
          onChange={(e) =>
            setAppearance({ ...appearance, accent: e.target.value as Appearance['accent'] })
          }
        >
          {['green', 'blue', 'purple', 'amber'].map((v) => (
            <option key={v} value={v}>
              {t(v)}
            </option>
          ))}
        </select>
      </label>
      <label className="field-label">
        {t('Interface font')}
        <select
          aria-label={t('Interface font')}
          value={appearance.font ?? 'system'}
          onChange={(e) =>
            setAppearance({ ...appearance, font: e.target.value as Appearance['font'] })
          }
        >
          <option value="system">{t('System')}</option>
          <option value="arial">Arial</option>
          <option value="georgia">Georgia</option>
        </select>
      </label>
      <label className="field-label">
        {t('Terminal font')}
        <select
          aria-label={t('Terminal font')}
          value={appearance.terminalFont ?? 'cascadia'}
          onChange={(e) =>
            setAppearance({
              ...appearance,
              terminalFont: e.target.value as Appearance['terminalFont'],
            })
          }
        >
          <option value="cascadia">Cascadia Code</option>
          <option value="consolas">Consolas</option>
          <option value="courier">Courier New</option>
        </select>
      </label>
      <label className="field-label">
        {t('Layout density')}
        <select
          aria-label={t('Layout density')}
          value={appearance.density ?? 'comfortable'}
          onChange={(e) =>
            setAppearance({ ...appearance, density: e.target.value as Appearance['density'] })
          }
        >
          <option value="comfortable">{t('Comfortable')}</option>
          <option value="compact">{t('Compact')}</option>
        </select>
      </label>
      <label className="field-label">
        {t('Motion')}
        <select
          aria-label={t('Motion')}
          value={appearance.motion ?? 'system'}
          onChange={(e) =>
            setAppearance({ ...appearance, motion: e.target.value as Appearance['motion'] })
          }
        >
          <option value="system">{t('Follow system')}</option>
          <option value="reduce">{t('Reduce motion')}</option>
        </select>
      </label>
      <label className="field-label">
        {t('UI text size (%)')}
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
        {t('Log and terminal font size (px)')}
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
              await window.desktop.call('preferences:save', { appearance, language });
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
          {t('Save appearance')}
        </button>
        <button
          onClick={() => {
            setAppearance({ ...defaultAppearance });
            setNotice('Default fields restored. Save appearance to apply.');
          }}
        >
          {t('Reset appearance fields')}
        </button>
      </div>
      {notice && <p role="status">{t(notice)}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
