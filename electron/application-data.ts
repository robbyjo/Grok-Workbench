import { Chess } from 'chess.js';
import type { Wire } from '../shared/types';
export function text(value: unknown, limit = 4000) {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0'))
    throw new Error(`Expected text up to ${limit} characters.`);
  return value;
}
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e12;
export function officeInput(input: Wire) {
  const title = text(input.title ?? 'Workbench', 300);
  if (input.kind === 'word') {
    const body = text(input.text ?? '', 100000),
      table = input.table ?? [];
    if (
      !Array.isArray(table) ||
      table.length > 200 ||
      table.some(
        (r: any) =>
          !Array.isArray(r) ||
          !r.length ||
          r.length > 30 ||
          r.length !== table[0].length ||
          r.some((v: any) => typeof v !== 'string' || v.length > 4000),
      )
    )
      throw new Error('Word tables require up to 200 equal rows of 1..30 text cells.');
    return { operation: 'word', title, text: body, table };
  }
  if (input.kind !== 'spreadsheet') throw new Error('Choose word or spreadsheet.');
  const headers = input.headers,
    rows = input.rows;
  if (
    !Array.isArray(headers) ||
    !headers.length ||
    headers.length > 40 ||
    headers.some((v) => typeof v !== 'string' || v.length > 200)
  )
    throw new Error('Supply 1..40 text column headers.');
  if (
    !Array.isArray(rows) ||
    rows.length > 2000 ||
    rows.length * headers.length > 20000 ||
    rows.some(
      (r) =>
        !Array.isArray(r) ||
        r.length !== headers.length ||
        r.some((v) => v !== null && !finite(v) && !(typeof v === 'string' && v.length <= 2000)),
    )
  )
    throw new Error('Supply at most 20,000 text/numeric cells, with one cell per header.');
  const formulas = input.formulas ?? [];
  const allowed = new Set([
    'SUM',
    'AVERAGE',
    'MIN',
    'MAX',
    'COUNT',
    'COUNTA',
    'ROUND',
    'IF',
    'IFERROR',
    'ABS',
    'SQRT',
    'POWER',
    'STDEV.S',
    'VAR.S',
    'SUMPRODUCT',
    'MEDIAN',
  ]);
  if (!Array.isArray(formulas) || formulas.length > 100)
    throw new Error('At most 100 formulas are supported.');
  for (const f of formulas) {
    if (
      !f ||
      !/^[A-Z]{1,2}[1-9]\d{0,3}$/.test(f.cell) ||
      typeof f.formula !== 'string' ||
      f.formula.length > 1000 ||
      !f.formula.startsWith('=') ||
      !/^[=A-Za-z0-9_.,():+*/^% <>&"$\-]+$/.test(f.formula)
    )
      throw new Error('Invalid cell or formula. External links, DDE and macros are not supported.');
    for (const m of f.formula.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g))
      if (!allowed.has(m[1].toUpperCase()))
        throw new Error('Unsupported formula function: ' + m[1]);
  }
  return { operation: 'excel', title, headers, rows, formulas, chart: input.chart === true };
}
export function regressionInput(input: Wire) {
  const points = input.points;
  if (
    !Array.isArray(points) ||
    points.length < 3 ||
    points.length > 5000 ||
    points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(finite))
  )
    throw new Error('Regression requires 3..5000 finite [x,y] pairs.');
  if (new Set(points.map((p) => p[0])).size < 2)
    throw new Error('Regression requires at least two distinct x values.');
  const n = points.length,
    mx = points.reduce((s, p) => s + p[0], 0) / n,
    my = points.reduce((s, p) => s + p[1], 0) / n;
  const xx = points.reduce((s, p) => s + (p[0] - mx) ** 2, 0),
    xy = points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  if (!Number.isFinite(xx) || xx <= 0)
    throw new Error('The x variance is numerically unstable; inspect or rescale the data.');
  const slope = xy / xx,
    intercept = my - slope * mx,
    sse = points.reduce((s, p) => s + (p[1] - intercept - slope * p[0]) ** 2, 0),
    sst = points.reduce((s, p) => s + (p[1] - my) ** 2, 0);
  return {
    points,
    reference: {
      n,
      slope,
      intercept,
      rSquared: sst === 0 ? null : 1 - sse / sst,
      rmse: Math.sqrt(sse / (n - 2)),
    },
  };
}
const jslString = (v: string) =>
  '"' +
  v
    .replace(/\\/g, '/')
    .replace(/"/g, '\\!"')
    .replace(/[\r\n]/g, ' ') +
  '"';
export function jmpScript(input: Wire, root: string) {
  const { points } = regressionInput(input),
    path = (name: string) => jslString(root + '/' + name);
  const symbol = 'wb_' + root.replace(/[^a-zA-Z0-9]/g, '').slice(-30);
  return [
    '//!',
    'Names Default To Here(1);',
    `${symbol}=Function({}, {dt,fit,rpt,estimates}, Try(`,
    `dt=New Table("Workbench regression",Invisible,New Column("x",Numeric,Continuous,Values({${points.map((p) => p[0]).join(',')}})),New Column("y",Numeric,Continuous,Values({${points.map((p) => p[1]).join(',')}})));`,
    'fit=dt << Bivariate(Y(:y),X(:x),Fit Line(1));',
    'rpt=Report(fit);',
    `rpt << Save Picture(${path('regression.png')},"png");`,
    'estimates=rpt["Parameter Estimates"][Table Box(1)] << Make Into Data Table;',
    `estimates << Save(${path('estimates.csv')});`,
    `dt << Save(${path('data.jmp')});`,
    `Save Text File(${path('reproduce.jsl')}, Char(fit << Get Script));`,
    'Close(estimates,NoSave);',
    'fit << Close Window;',
    'Close(dt,NoSave);',
    `Save Text File(${path('complete.txt')},"complete");`,
    `, Save Text File(${path('error.txt')},Char(exception_msg)); Try(Close(estimates,NoSave)); Try(fit << Close Window); Try(Close(dt,NoSave));`,
    '));',
    `${symbol}(); Clear Symbols(${symbol});`,
    '',
  ].join('\n');
}
export function verifyJmpEstimates(csv: string, reference: Wire) {
  const rows = csv
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(','));
  const slope = rows.find((row) => row[0].replace(/^"|"$/g, '') === 'x'),
    intercept = rows.find((row) => row !== slope);
  const actual = { slope: Number(slope?.[1]), intercept: Number(intercept?.[1]) };
  for (const key of ['slope', 'intercept'] as const)
    if (
      !Number.isFinite(actual[key]) ||
      Math.abs(actual[key] - reference[key]) > 1e-7 * Math.max(1, Math.abs(reference[key]))
    )
      throw new Error(
        'Native JMP coefficient verification failed; inspect the native report and reference data.',
      );
  return { ...actual, verifiedAgainstIndependentOLS: true };
}
export function blenderInput(input: Wire) {
  const objects = input.objects;
  if (!Array.isArray(objects) || !objects.length || objects.length > 80)
    throw new Error('Supply 1..80 scene objects.');
  const vector = (v: any, fallback: number[]) => {
    v = v ?? fallback;
    if (
      !Array.isArray(v) ||
      v.length !== 3 ||
      !v.every(finite) ||
      v.some((n) => Math.abs(n) > 10000)
    )
      throw new Error('Invalid scene vector.');
    return v;
  };
  return {
    objects: objects.map((o: any) => {
      if (!['cube', 'sphere', 'cylinder', 'plane', 'torus'].includes(o.kind))
        throw new Error('Supported primitives: cube, sphere, cylinder, plane, torus.');
      const color = o.color ?? [0.2, 0.5, 0.8, 1];
      if (
        !Array.isArray(color) ||
        color.length !== 4 ||
        color.some((v) => !finite(v) || v < 0 || v > 1)
      )
        throw new Error('Color requires four RGBA values in 0..1.');
      return {
        kind: o.kind,
        name: text(o.name ?? o.kind, 100),
        location: vector(o.location, [0, 0, 0]),
        scale: vector(o.scale, [1, 1, 1]),
        color,
      };
    }),
  };
}
export const blenderScript = `import bpy,json,sys,os,math\nfrom mathutils import Vector\nroot=sys.argv[sys.argv.index('--')+1]\nwith open(os.path.join(root,'input.json'),encoding='utf-8') as f: cfg=json.load(f)\nbpy.ops.object.select_all(action='SELECT')\nbpy.ops.object.delete(use_global=False)\nops={'cube':bpy.ops.mesh.primitive_cube_add,'sphere':bpy.ops.mesh.primitive_uv_sphere_add,'cylinder':bpy.ops.mesh.primitive_cylinder_add,'plane':bpy.ops.mesh.primitive_plane_add,'torus':bpy.ops.mesh.primitive_torus_add}\nfor item in cfg['objects']:\n ops[item['kind']](location=item['location'])\n obj=bpy.context.object;obj.name=item['name'];obj.scale=item['scale']\n mat=bpy.data.materials.new(item['name']+' material');mat.diffuse_color=item['color'];obj.data.materials.append(mat)\nscene=bpy.context.scene\nbpy.ops.object.camera_add(location=(8,-10,8))\ncam=bpy.context.object;cam.rotation_euler=((Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler());scene.camera=cam\nscene.render.engine='BLENDER_WORKBENCH'\nscene.display.shading.light='STUDIO';scene.display.shading.color_type='MATERIAL';scene.display.shading.show_shadows=True\nscene.render.resolution_x=640;scene.render.resolution_y=480;scene.render.resolution_percentage=100\nscene.render.image_settings.file_format='PNG';scene.render.filepath=os.path.join(root,'scene.png')\nbpy.ops.wm.save_as_mainfile(filepath=os.path.join(root,'scene.blend'))\nbpy.ops.render.render(write_still=True)\nwith open(os.path.join(root,'scene.json'),'w',encoding='utf-8') as f: json.dump({'blender':bpy.app.version_string,'objects':[{'name':o.name,'type':o.type,'location':list(o.location),'scale':list(o.scale)} for o in scene.objects]},f)\n`;
export function shoppingPlan(input: Wire) {
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100)
    throw new Error('Supply 1..100 observed cart items.');
  const currency = text(input.currency ?? 'USD', 3);
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error('Use one ISO currency; exchange conversion is not provided.');
  const cents = (v: any) => {
    if (!finite(v) || v < 0 || v > 1e7)
      throw new Error('Prices must be nonnegative finite amounts.');
    return Math.round(v * 100);
  };
  const items = input.items.map((i: any) => {
    const quantity = i.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000)
      throw new Error('Quantity must be 1..1000.');
    if (i.currency && i.currency !== currency)
      throw new Error('Mixed currencies cannot be totaled.');
    let url = i.url ?? '';
    if (url && !/^https?:\/\//i.test(url)) throw new Error('Product links must be HTTP(S).');
    return {
      name: text(i.name, 300),
      quantity,
      unitPrice: cents(i.price) / 100,
      lineTotal: (cents(i.price) * quantity) / 100,
      url,
    };
  });
  const subtotal = items.reduce((s, i) => s + Math.round(i.lineTotal * 100), 0),
    shipping = cents(input.shipping ?? 0),
    tax = cents(input.tax ?? 0),
    total = subtotal + shipping + tax;
  const budget = input.budget === undefined ? undefined : cents(input.budget);
  const missingCosts = input.shipping === undefined || input.tax === undefined;
  return {
    items,
    currency,
    subtotal: subtotal / 100,
    shipping: shipping / 100,
    tax: tax / 100,
    total: total / 100,
    totalKind: missingCosts ? 'known-costs-only' : 'complete-as-entered',
    withinBudget: budget === undefined || missingCosts ? null : total <= budget,
    withinKnownBudget: budget === undefined ? null : total <= budget,
    budget: budget === undefined ? null : budget / 100,
    missingCosts,
    instruction:
      'This checks observed prices only; it does not verify stock, place an order or authorize checkout. Stop shopping preparation at review and let the user complete purchases.',
  };
}
export function chessPosition(input: Wire) {
  const chess = new Chess(input.fen === undefined ? undefined : text(input.fen, 150));
  const moves = input.moves ?? [];
  if (!Array.isArray(moves) || moves.length > 500)
    throw new Error('At most 500 moves per request.');
  for (const raw of moves) {
    const move = text(raw, 20);
    if (['--', '0000', 'null'].includes(move.toLowerCase()))
      throw new Error('Null/pass moves are not legal game moves.');
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) chess.move(move, { strict: true });
    else chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
  }
  if (chess.isCheckmate()) chess.setHeader('Result', chess.turn() === 'w' ? '0-1' : '1-0');
  else if (chess.isDraw()) chess.setHeader('Result', '1/2-1/2');
  return {
    fen: chess.fen(),
    turn: chess.turn(),
    check: chess.isCheck(),
    checkmate: chess.isCheckmate(),
    draw: chess.isDraw(),
    gameOver: chess.isGameOver(),
    legalMoves: chess.moves(),
    board: chess.ascii(),
    pgn: chess.pgn(),
    instruction:
      'Synchronize this FEN with the visible board before moving. This is a rules checker, not a chess-strength engine; use offline/unrated practice.',
  };
}
