import { t } from '../shared/i18n';
import { useState } from 'react';
import type { State } from '../shared/types';
import { permissionModeDescriptions } from '../shared/permissions';

export default function PermissionSettings({ state }: { state: State }) {
  const [mode, setMode] = useState(state.settings.defaultPermissionMode ?? 'ask');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <section>
      <h3>Default permissions</h3>
      <label className="field-label">
        Permission mode for new chats
        <select
          value={mode}
          disabled={saving}
          onChange={(event) => {
            setMode(event.target.value as typeof mode);
            setNotice('');
            setError('');
          }}
        >
          <option value="ask">{t('Always ask')}</option>
          <option value="auto">{t('Approve for me')}</option>
          <option value="always-approve">{t('Approve all')}</option>
        </select>
      </label>
      <p className="muted">
        Applies to chats created after saving. Existing chats keep their permission mode.{' '}
        {permissionModeDescriptions[mode]}
      </p>
      <button
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          setNotice('');
          try {
            await window.desktop.call('preferences:save', { defaultPermissionMode: mode });
            setNotice('Default permissions saved.');
            setError('');
          } catch (e) {
            setError(String(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        Save default permissions
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
