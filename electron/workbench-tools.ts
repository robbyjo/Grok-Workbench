import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Wire } from '../shared/types';
import type { WindowsDesktop } from './windows-desktop';
import type { Narrator } from './narration';
import { workbenchTools } from './workbench-tool-schema';
import { applicationTools } from './application-schema';
import type { Workstation } from './workstation';
import type { DesktopWorkflows } from './desktop-workflows';
import { desktopWorkflowTools } from './workflows/schema';

export class WorkbenchTools {
  private server?: Server;
  private endpoint = '';
  private tokens = new Map<string, string>();
  constructor(
    private desktop: WindowsDesktop,
    private narrator: Narrator,
    private allowed: (id: string) => boolean = () => true,
    private workstation?: Workstation,
    private workflows?: DesktopWorkflows,
  ) {}
  async start() {
    const server = createServer(async (req, res) => {
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const id = token ? [...this.tokens].find(([, t]) => t === token)?.[0] : undefined;
      if (req.method !== 'POST' || req.url !== '/rpc' || req.headers.origin || !id) {
        res.writeHead(403).end();
        return;
      }
      let length = 0;
      const chunks: Buffer[] = [];
      try {
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 550000) throw new Error('Request too large.');
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const value =
          input.operation === 'list'
            ? {
                tools: [
                  ...workbenchTools(process.platform === 'win32'),
                  ...(this.workstation ? applicationTools : []),
                  ...(this.workflows ? desktopWorkflowTools : []),
                ],
              }
            : await this.invoke(id, input.name, input.input);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(value));
      } catch (e) {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            isError: true,
            content: [{ type: 'text', text: (e as Error).message }],
          }),
        );
      }
    });
    server.requestTimeout = 40000;
    server.headersTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    this.server = server;
    this.endpoint = `http://127.0.0.1:${(server.address() as any).port}/rpc`;
  }
  servers(id: string) {
    if (!this.endpoint) throw new Error('Workbench tools are not ready.');
    if (!this.tokens.has(id)) this.tokens.set(id, randomBytes(32).toString('hex'));
    return [
      {
        name: 'workbench',
        command: process.execPath,
        args: [join(__dirname, 'workbench-mcp.js')],
        env: [
          { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
          { name: 'GROK_WORKBENCH_ENDPOINT', value: this.endpoint },
          { name: 'GROK_WORKBENCH_TOKEN', value: this.tokens.get(id)! },
        ],
      },
    ];
  }
  async invoke(id: string, name: string, input: Wire = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Tool input must be an object.');
    const schema = [
      ...workbenchTools(process.platform === 'win32'),
      ...(this.workstation ? applicationTools : []),
      ...(this.workflows ? desktopWorkflowTools : []),
    ].find((t) => t.name === name)?.inputSchema;
    if (!schema || Object.keys(input).some((k) => !Object.hasOwn(schema.properties, k)))
      throw new Error('Unknown tool or argument.');
    let value: any;
    if (this.workflows?.handles(name)) {
      if (
        !['workflow_status', 'workflow_artifact', 'browser_view', 'zotero_read'].includes(name) &&
        !this.allowed(id)
      )
        throw new Error('Wait for the current workspace/application workflow.');
      return this.workflows.invoke(id, name, input);
    }
    if (this.workstation?.handles(name)) {
      if (
        ['office_create', 'office_edit', 'blender_create', 'jmp_analyze', 'krita_tools'].includes(
          name,
        ) &&
        !this.allowed(id)
      )
        throw new Error('Wait for the current workspace/application operation.');
      return this.workstation.invoke(id, name, input);
    }
    if (name === 'read_aloud_status') value = this.narrator.list(id);
    else if (name === 'read_aloud_control')
      value = this.narrator.control(id, input.job_id, input.action);
    else if (name === 'read_aloud') {
      if (!this.allowed(id))
        throw new Error('Wait for the current workspace/configuration or media operation.');
      value = await this.narrator.start(id, input);
    } else {
      if (!this.allowed(id))
        throw new Error(
          'Desktop control is unavailable during workspace/configuration operations.',
        );
      return this.desktop.tool(id, name, input);
    }
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  }
  close() {
    this.tokens.clear();
    this.server?.closeAllConnections();
    this.server?.close();
  }
}
