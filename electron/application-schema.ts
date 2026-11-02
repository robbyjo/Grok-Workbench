const object = (properties: Record<string, any>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
export const applicationTools = [
  {
    name: 'application_catalog',
    description:
      'Inspect installed Word, Excel, Krita, Blender, JMP and Lucas Chess integrations, this chat’s opt-in grants and job statuses. Installed does not mean validated. Desktop tools operate only the window selected by the user.',
    inputSchema: object({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'application_jobs',
    description:
      'Get actual completion, artifacts, native numerical results and errors from this chat’s application jobs. A queued job is not success.',
    inputSchema: object({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'application_preview',
    description:
      'See a PNG render or graph produced by one completed application job in this chat. Use this to verify actual Blender/JMP visual results before claiming visual success. Only owned job artifacts can be previewed.',
    inputSchema: object(
      { job_id: { type: 'string', maxLength: 100 }, name: { type: 'string', maxLength: 100 } },
      ['job_id', 'name'],
    ),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'office_create',
    description:
      'Create a NEW Word DOCX, Excel XLSX or PowerPoint PPTX (optional PDF) using installed Microsoft Office COM APIs, in this workspace’s unique workbench-output folder. Requires this chat’s Office grant. Does not open/overwrite existing user documents. Word can embed up to five workspace PNGs. Excel calculates supplied formulas and returns actual results; optional column chart. Use application_jobs to verify completion.',
    inputSchema: object(
      {
        kind: { type: 'string', enum: ['word', 'spreadsheet', 'presentation'] },
        title: { type: 'string', maxLength: 300 },
        text: { type: 'string', maxLength: 100000 },
        table: {
          type: 'array',
          maxItems: 200,
          items: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 4000 } },
        },
        headers: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 200 } },
        rows: {
          type: 'array',
          maxItems: 2000,
          items: { type: 'array', maxItems: 40, items: { type: ['string', 'number', 'null'] } },
        },
        formulas: {
          type: 'array',
          maxItems: 100,
          items: object(
            { cell: { type: 'string' }, formula: { type: 'string', maxLength: 1000 } },
            ['cell', 'formula'],
          ),
        },
        chart: { type: 'boolean' },
        images: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 4096 } },
        slides: {
          type: 'array',
          maxItems: 30,
          items: object({
            title: { type: 'string', maxLength: 300 },
            text: { type: 'string', maxLength: 10000 },
          }),
        },
        pdf: { type: 'boolean' },
      },
      ['kind'],
    ),
  },
  {
    name: 'office_edit',
    description:
      'Edit a NEW COPY of a workspace DOCX/XLSX/PPTX using installed Office, preserving the source. Requires Office grant. Word supports literal replacements, anchored comments, appended text and tracked changes (default on). Excel supports typed cell updates, allowlisted formulas and optional chart. Presentation appends slides and can export PDF. Active/external Office content is refused. Inspect application_jobs for actual completion.',
    inputSchema: object(
      {
        kind: { type: 'string', enum: ['word', 'spreadsheet', 'presentation'] },
        path: { type: 'string', maxLength: 4096 },
        replacements: {
          type: 'array',
          maxItems: 100,
          items: object({ find: { type: 'string' }, replace: { type: 'string' } }, [
            'find',
            'replace',
          ]),
        },
        comments: {
          type: 'array',
          maxItems: 100,
          items: object({ find: { type: 'string' }, text: { type: 'string' } }, ['find', 'text']),
        },
        append: { type: 'string', maxLength: 100000 },
        tracked_changes: { type: 'boolean' },
        sheet: { type: 'string' },
        cells: {
          type: 'array',
          maxItems: 1000,
          items: object(
            { cell: { type: 'string' }, value: { type: ['string', 'number', 'null'] } },
            ['cell', 'value'],
          ),
        },
        formulas: {
          type: 'array',
          maxItems: 100,
          items: object({ cell: { type: 'string' }, formula: { type: 'string' } }, [
            'cell',
            'formula',
          ]),
        },
        chart: { type: 'boolean' },
        title: { type: 'string' },
        slides: {
          type: 'array',
          maxItems: 30,
          items: object({ title: { type: 'string' }, text: { type: 'string' } }),
        },
        pdf: { type: 'boolean' },
      },
      ['kind', 'path'],
    ),
  },
  {
    name: 'blender_create',
    description:
      'Create and render a NEW editable Blender scene using the installed Blender in an isolated factory-startup/background process. Preserves open scenes. Requires Blender grant. Primitive meshes, transforms and RGBA materials; saves .blend, PNG and native scene manifest. Use application_jobs to verify results. This is a procedural starter, not a promise of finished artwork.',
    inputSchema: object(
      {
        objects: {
          type: 'array',
          minItems: 1,
          maxItems: 80,
          items: object(
            {
              kind: { type: 'string', enum: ['cube', 'sphere', 'cylinder', 'plane', 'torus'] },
              name: { type: 'string', maxLength: 100 },
              location: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
              scale: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
              color: {
                type: 'array',
                minItems: 4,
                maxItems: 4,
                items: { type: 'number', minimum: 0, maximum: 1 },
              },
            },
            ['kind'],
          ),
        },
      },
      ['objects'],
    ),
  },
  {
    name: 'jmp_analyze',
    description:
      'Run a native JMP 16 scatterplot and ordinary least-squares linear regression with intercept on supplied numeric [x,y] pairs. Requires JMP grant. Writes a new data table, PNG, native parameter-estimate CSV and reproducible JSL. Missing/nonfinite/constant-x inputs are refused. Independent reference OLS values are labeled separately from JMP’s results; verify native estimates and assumptions before interpreting. Use application_jobs for completion.',
    inputSchema: object(
      {
        points: {
          type: 'array',
          minItems: 3,
          maxItems: 5000,
          items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
        },
      },
      ['points'],
    ),
  },
  {
    name: 'krita_tools',
    description:
      'Use the existing offline-installed Krita Codex MCP 0.2.2 bridge. Requires Krita grant and existing bridge/server. No tool: search its schemas with query (max12). Tool set: krita_document/state/preview/canvas/layers/brush/paint_path/draw/color/history/save_export/edit. Document actions: list, compatibility, create (up to 4096x4096, four open per chat), activate, close. Opening existing files and document.save are excluded; use krita_save_export with new paths and overwrite=false. Mutations/previews are restricted to NEW documents created by this chat; existing artwork is preserved. Inspect state before edits and preview afterwards. Native allowed roots stay unchanged. Never retry a timed-out mutation; inspect state. Supply exact arguments from the returned schema.',
    inputSchema: object({
      query: { type: 'string', maxLength: 100 },
      tool: { type: 'string', maxLength: 100 },
      arguments: { type: 'object' },
    }),
  },
  {
    name: 'shopping_plan',
    description:
      'Check the arithmetic and budget of observed shopping/cart items without placing an order or spending money. Read current offers in the user-selected browser with desktop tools, then supply prices/quantities and known shipping/tax. Returns subtotal, total, budget check and missing-cost flag. No currency conversion or stock/price verification. Shopping scope is research/cart preparation only; let the user complete checkout.',
    inputSchema: object(
      {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: object(
            {
              name: { type: 'string', maxLength: 300 },
              price: { type: 'number', minimum: 0 },
              quantity: { type: 'integer', minimum: 1, maximum: 1000 },
              currency: { type: 'string' },
              url: { type: 'string' },
            },
            ['name', 'price'],
          ),
        },
        currency: { type: 'string', minLength: 3, maxLength: 3 },
        shipping: { type: 'number', minimum: 0 },
        tax: { type: 'number', minimum: 0 },
        budget: { type: 'number', minimum: 0 },
      },
      ['items'],
    ),
  },
  {
    name: 'chess_position',
    description:
      'Validate a chess FEN and SAN/UCI moves, return legal moves, board, turn, check/mate/draw and PGN. Optional export writes a NEW PGN in this workspace. Synchronize the FEN with the visible board before using desktop click/drag to move in Lucas Chess or an offline browser board. This enforces rules, not playing strength; no engine is bundled and no live rated play is requested.',
    inputSchema: object({
      fen: { type: 'string', maxLength: 150 },
      moves: { type: 'array', maxItems: 500, items: { type: 'string', maxLength: 20 } },
      export: { type: 'boolean' },
    }),
  },
];
