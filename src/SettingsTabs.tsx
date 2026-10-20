import { useState, type ReactNode } from 'react';

export default function SettingsTabs({
  tabs,
}: {
  tabs: { id: string; name: string; content: ReactNode }[];
}) {
  const [selected, setSelected] = useState(tabs[0].id);
  const [visited, setVisited] = useState(new Set([tabs[0].id]));
  function select(id: string) {
    setVisited((previous) => new Set([...previous, id]));
    setSelected(id);
  }
  return (
    <div className="settings-layout">
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings categories"
        aria-orientation="vertical"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`settings-tab-${tab.id}`}
            role="tab"
            aria-selected={selected === tab.id}
            aria-controls={`settings-panel-${tab.id}`}
            tabIndex={selected === tab.id ? 0 : -1}
            onClick={() => select(tab.id)}
            onKeyDown={(event) => {
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : ['ArrowDown', 'ArrowRight'].includes(event.key)
                      ? (index + 1) % tabs.length
                      : ['ArrowUp', 'ArrowLeft'].includes(event.key)
                        ? (index + tabs.length - 1) % tabs.length
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              select(tabs[next].id);
              document.getElementById(`settings-tab-${tabs[next].id}`)?.focus();
            }}
          >
            {tab.name}
          </button>
        ))}
      </div>
      <div className="settings-panels">
        {tabs.map((tab) => (
          <section
            key={tab.id}
            id={`settings-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`settings-tab-${tab.id}`}
            hidden={selected !== tab.id}
            tabIndex={0}
            className="settings-panel"
          >
            {visited.has(tab.id) && tab.content}
          </section>
        ))}
      </div>
    </div>
  );
}
