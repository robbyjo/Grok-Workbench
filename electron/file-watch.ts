import { watch, realpathSync, type FSWatcher } from 'node:fs';
import { resolve, sep } from 'node:path';

/** One recursive subscription for the visible workspace; no file contents cross this channel. */
export class WorkspaceWatch {
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private generation = 0;
  close() {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.watcher?.close();
    this.watcher = undefined;
  }
  start(root: string, changed: () => void, profile?: string) {
    this.close();
    const generation = this.generation;
    const canonical = realpathSync.native(root);
    const normalize = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
    const profilePath = profile ? normalize(resolve(profile)) : undefined;
    this.watcher = watch(canonical, { recursive: true }, (_event, name) => {
      const parts = String(name ?? '')
        .replaceAll('\\', '/')
        .split('/');
      if (
        parts.some((p) =>
          [
            'node_modules',
            'target',
            '.runtime',
            '.test-data',
            'dist',
            'dist-electron',
            'release',
          ].includes(p),
        )
      )
        return;
      const absolute = normalize(resolve(canonical, String(name ?? '')));
      if (
        profilePath &&
        profilePath.startsWith(normalize(canonical) + sep) &&
        profilePath !== normalize(canonical) &&
        (absolute === profilePath || absolute.startsWith(profilePath + sep))
      )
        return;
      if (
        profilePath === normalize(canonical) &&
        (/^(state\.json|history\.sqlite)/.test(parts[0]) ||
          [
            'diagnostics',
            'media-files',
            'account',
            'Cache',
            'Code Cache',
            'GPUCache',
            'Session Storage',
            'Local Storage',
          ].includes(parts[0]))
      )
        return;
      if (
        parts.includes('.git') &&
        !parts.some((p) => ['index', 'HEAD', 'refs', 'packed-refs'].includes(p))
      )
        return;
      if (this.timer) return;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (generation === this.generation) changed();
      }, 200);
    });
    this.watcher.on('error', () => {
      this.close();
      changed(); // Focus reconciliation remains available if the OS loses the watch.
    });
  }
}
