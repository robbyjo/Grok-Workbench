import { t } from '../shared/i18n';
import { Circle, ShieldCheck } from 'lucide-react';
import type { Thread, Wire } from '../shared/types';
import { savedPermissionMode, permissionModeDescriptions } from '../shared/permissions';

export default function ConfigControls({
  thread,
  action,
}: {
  thread: Thread;
  action: (method: string, args?: Wire) => Promise<any>;
}) {
  const configs = thread.session?.configOptions ?? [];
  const permissionMode = savedPermissionMode(thread);
  const busy = ['running', 'approval', 'connecting'].includes(thread.status);
  return (
    <div className="config-controls">
      {['running', 'approval', 'connecting'].includes(thread.status) && (
        <small className="muted">
          Model and reasoning settings are available when the chat is idle.
        </small>
      )}
      {!thread.session?.connected &&
        !['running', 'approval', 'connecting'].includes(thread.status) && (
          <button onClick={() => void action('agent:connect', { id: thread.id })}>
            {t('Connect to refresh model choices')}
          </button>
        )}
      {configs.length ? (
        configs
          .filter((item: Wire) => item.type === 'select')
          .map((config: Wire) => {
            const values = (config.options ?? []).flatMap((item: Wire) => item.options ?? [item]);
            return (
              <label key={config.id} title={config.name ?? config.id}>
                <select
                  aria-label={config.name ?? config.id}
                  disabled={['running', 'approval', 'connecting'].includes(thread.status)}
                  value={config.currentValue}
                  onChange={(event) =>
                    void action('agent:config', {
                      id: thread.id,
                      configId: config.id,
                      value: event.target.value,
                    })
                  }
                >
                  {!values.some((item: Wire) => item.value === config.currentValue) && (
                    <option value={config.currentValue}>{config.currentValue}</option>
                  )}
                  {values.map((item: Wire) => (
                    <option value={item.value} key={item.value}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })
      ) : (
        <span className="muted">
          <Circle size={10} /> Grok defaults
        </span>
      )}
      {thread.session?.modes?.availableModes && (
        <select
          aria-label="Agent mode"
          disabled={['running', 'approval', 'connecting'].includes(thread.status)}
          value={thread.session.modes.currentModeId}
          onChange={(event) =>
            void action('agent:config', {
              id: thread.id,
              configId: '__mode',
              value: event.target.value,
            })
          }
        >
          {thread.session.modes.availableModes.map((mode: Wire) => (
            <option value={mode.id} key={mode.id}>
              {mode.name}
            </option>
          ))}
        </select>
      )}
      <label
        className="permission-label"
        title={
          busy
            ? 'Change permission mode while the chat is idle.'
            : permissionMode
              ? permissionModeDescriptions[permissionMode]
              : 'Using the engine permission default. Choose a mode for this chat.'
        }
      >
        <ShieldCheck size={13} />
        <select
          aria-label="Permission mode for this chat"
          value={permissionMode ?? 'engine-default'}
          disabled={busy}
          onChange={(event) =>
            void action('permission:set-mode', { id: thread.id, mode: event.target.value })
          }
        >
          {permissionMode === undefined && (
            <option value="engine-default" disabled>
              Grok default
            </option>
          )}
          <option value="ask">{t('Always ask')}</option>
          <option value="auto" disabled={thread.session?.autoPermissionModeEnabled === false}>
            {t('Approve for me')}
          </option>
          <option value="always-approve">{t('Approve all')}</option>
        </select>
      </label>
      {permissionMode === 'auto' && thread.session?.autoPermissionModeEnabled === false && (
        <small className="muted">
          Grok has disabled Approve for me; tools still require approval.
        </small>
      )}
    </div>
  );
}
