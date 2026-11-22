import { z } from 'zod';

export const ToneEnum = z.enum([
  'default',
  'accent',
  'positive',
  'negative',
  'warn',
  'purple',
  'muted',
]);

export const LineStyleEnum = z.enum(['solid', 'dashed', 'dotted']);

export const CoordTuple = z.tuple([z.number().int(), z.number().int()]);

const CellValueSchema = z.union([z.string(), z.number(), z.boolean()]).transform(String);

export const GridAnnotSpecSchema = z.object({
  type: z.literal('grid-annot'),
  title: z.string().optional(),
  cells: z.array(z.array(CellValueSchema)).min(1, 'cells 至少需要包含 1 行数据'),
  rowHeaders: z.array(CellValueSchema).optional(),
  colHeaders: z.array(CellValueSchema).optional(),
  brackets: z.enum(['none', 'matrix', 'det', 'box']).optional().default('none'),
  cellWidth: z.number().positive().optional(),
  cellHeight: z.number().positive().optional(),
  highlights: z
    .array(
      z.object({
        row: z.number().int(),
        col: z.number().int(),
        tone: ToneEnum.optional(),
        label: z.string().optional(),
      })
    )
    .optional(),
  boxes: z
    .array(
      z.object({
        from: CoordTuple,
        to: CoordTuple,
        tone: ToneEnum.optional(),
        label: z.string().optional(),
        dashed: z.boolean().optional(),
      })
    )
    .optional(),
  arrows: z
    .array(
      z.object({
        from: CoordTuple,
        to: CoordTuple,
        label: z.string().optional(),
        tone: ToneEnum.optional(),
        style: LineStyleEnum.optional(),
        dashed: z.boolean().optional(),
        curve: z.number().optional(),
      })
    )
    .optional(),
  diagonals: z
    .array(
      z.object({
        cells: z.array(CoordTuple).min(2, '每条对角线至少需要 2 个格点坐标'),
        label: z.string().optional(),
        tone: ToneEnum.optional(),
        style: LineStyleEnum.optional(),
        dashed: z.boolean().optional(),
      })
    )
    .optional(),
  notes: z.array(z.string()).optional(),
});

export const Plot2dFunctionSchema = z.object({
  expr: z.string().min(1, '函数表达式 expr 不能为空'),
  label: z.string().optional(),
  color: z.string().optional(),
  tone: ToneEnum.optional(),
  style: LineStyleEnum.optional(),
  domain: z.tuple([z.number(), z.number()]).optional(),
});

export const Plot2dSpecSchema = z
  .object({
    type: z.literal('plot2d'),
    title: z.string().optional(),
    xRange: z
      .tuple([z.number(), z.number()])
      .refine(([min, max]) => max > min, 'xRange 必须满足 [min, max] 且 max > min')
      .default([-5, 5]),
    yRange: z
      .tuple([z.number(), z.number()])
      .refine(([min, max]) => max > min, 'yRange 必须满足 [min, max] 且 max > min')
      .optional(),
    xLabel: z.string().optional().default('x'),
    yLabel: z.string().optional().default('y'),
    grid: z.boolean().optional().default(true),
    functions: z.array(Plot2dFunctionSchema).default([]),
    shadedRegions: z
      .array(
        z.object({
          expr: z.string().min(1, 'shadedRegions.expr 不能为空'),
          expr2: z.string().optional(),
          from: z.number(),
          to: z.number(),
          tone: ToneEnum.optional(),
          label: z.string().optional(),
        })
      )
      .optional(),
    points: z
      .array(
        z.object({
          x: z.number(),
          y: z.number(),
          label: z.string().optional(),
          tone: ToneEnum.optional(),
          showProjections: z.boolean().optional(),
        })
      )
      .optional(),
    vlines: z
      .array(
        z.object({
          x: z.number(),
          label: z.string().optional(),
          tone: ToneEnum.optional(),
          style: LineStyleEnum.optional(),
        })
      )
      .optional(),
    hlines: z
      .array(
        z.object({
          y: z.number(),
          label: z.string().optional(),
          tone: ToneEnum.optional(),
          style: LineStyleEnum.optional(),
        })
      )
      .optional(),
  })
  .refine(
    (data) =>
      data.functions.length > 0 ||
      (data.shadedRegions && data.shadedRegions.length > 0) ||
      (data.points && data.points.length > 0),
    'plot2d 至少需要提供 functions、shadedRegions 或 points 之一'
  );

export const GraphSpecSchema = z.object({
  type: z.literal('graph'),
  title: z.string().optional(),
  direction: z.enum(['LR', 'TB', 'RL', 'BT']).optional().default('LR'),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1, '节点 id 不能为空'),
        label: z.string().optional(),
        subLabel: z.string().optional(),
        shape: z
          .enum(['rect', 'round', 'circle', 'diamond', 'pill', 'sum'])
          .optional()
          .default('round'),
        tone: ToneEnum.optional().default('default'),
      })
    )
    .min(1, 'graph 至少需要 1 个节点'),
  edges: z
    .array(
      z.object({
        from: z.string().min(1, '边的起点 from 不能为空'),
        to: z.string().min(1, '边的终点 to 不能为空'),
        label: z.string().optional(),
        style: LineStyleEnum.optional().default('solid'),
        tone: ToneEnum.optional().default('default'),
        bidirectional: z.boolean().optional(),
      })
    )
    .default([]),
});

export const WaveDromSpecSchema = z
  .object({
    type: z.literal('wavedrom'),
    title: z.string().optional(),
    signal: z.array(z.any()).optional(),
    reg: z.array(z.any()).optional(),
    head: z.record(z.string(), z.any()).optional(),
    foot: z.record(z.string(), z.any()).optional(),
    config: z.record(z.string(), z.any()).optional(),
    edge: z.array(z.string()).optional(),
  })
  .refine(
    (data) =>
      (Array.isArray(data.signal) && data.signal.length > 0) ||
      (Array.isArray(data.reg) && data.reg.length > 0),
    'wavedrom 必须提供非空的 signal（时序波形）或 reg（寄存器位域）数组'
  );

export const CircuitElementKindEnum = z.enum([
  'voltage_dc',
  'voltage_ac',
  'current_source',
  'resistor',
  'capacitor',
  'inductor',
  'diode',
  'ground',
  'wire',
  'node',
  'opamp',
  'npn',
  'pnp',
  'nmos',
  'pmos',
]);

export const CircuitElementSchema = z.object({
  kind: CircuitElementKindEnum,
  id: z.string().optional(),
  label: z.string().optional(),
  value: z.string().optional(),
  dir: z.enum(['right', 'down', 'left', 'up']).optional().default('right'),
  fromAnchor: z.string().optional(),
  toAnchor: z.string().optional(),
  anchor: z.string().optional(),
  currentLabel: z.string().optional(),
  polarity: z.enum(['+-', '-+', 'none']).optional(),
  tone: ToneEnum.optional(),
  length: z.number().positive().optional(),
  pin: z.string().optional(),
  flip: z.boolean().optional(),
  route: z.enum(['auto', 'hv', 'vh']).optional(),
  depletion: z.boolean().optional(),
});

export const CircuitSpecSchema = z.object({
  type: z.literal('circuit'),
  title: z.string().optional(),
  elements: z.array(CircuitElementSchema).min(1, 'circuit 至少需要 1 个电路元件'),
});

export const DiagramSpecSchema = z.union([
  GridAnnotSpecSchema,
  Plot2dSpecSchema,
  GraphSpecSchema,
  WaveDromSpecSchema,
  CircuitSpecSchema,
]);

export type GridAnnotSpec = z.infer<typeof GridAnnotSpecSchema>;
export type Plot2dSpec = z.infer<typeof Plot2dSpecSchema>;
export type GraphSpec = z.infer<typeof GraphSpecSchema>;
export type WaveDromSpec = z.infer<typeof WaveDromSpecSchema>;
export type CircuitElementSpec = z.infer<typeof CircuitElementSchema>;
export type CircuitElementKind = z.infer<typeof CircuitElementKindEnum>;
export type CircuitSpec = z.infer<typeof CircuitSpecSchema>;
export type DiagramSpec = z.infer<typeof DiagramSpecSchema>;
export type DiagramEngineType = DiagramSpec['type'];

const TONE_ALIAS_MAP: Record<string, z.infer<typeof ToneEnum>> = {
  default: 'default',
  neutral: 'default',
  white: 'default',
  accent: 'accent',
  primary: 'accent',
  blue: 'accent',
  sky: 'accent',
  cyan: 'accent',
  positive: 'positive',
  green: 'positive',
  emerald: 'positive',
  plus: 'positive',
  negative: 'negative',
  red: 'negative',
  rose: 'negative',
  minus: 'negative',
  warn: 'warn',
  warning: 'warn',
  amber: 'warn',
  yellow: 'warn',
  orange: 'warn',
  purple: 'purple',
  violet: 'purple',
  muted: 'muted',
  gray: 'muted',
  grey: 'muted',
};

function normalizeToneValue(tone: unknown): unknown {
  if (typeof tone !== 'string') return tone;
  const key = tone.trim().toLowerCase();
  return TONE_ALIAS_MAP[key] || tone;
}

const CIRCUIT_KIND_ALIAS_MAP: Record<string, CircuitElementKind> = {
  voltage_dc: 'voltage_dc',
  vdc: 'voltage_dc',
  dc_source: 'voltage_dc',
  battery: 'voltage_dc',
  voltage_ac: 'voltage_ac',
  vac: 'voltage_ac',
  ac_source: 'voltage_ac',
  current_source: 'current_source',
  idc: 'current_source',
  isource: 'current_source',
  resistor: 'resistor',
  res: 'resistor',
  r: 'resistor',
  capacitor: 'capacitor',
  cap: 'capacitor',
  c: 'capacitor',
  inductor: 'inductor',
  ind: 'inductor',
  l: 'inductor',
  diode: 'diode',
  d: 'diode',
  ground: 'ground',
  gnd: 'ground',
  wire: 'wire',
  line: 'wire',
  node: 'node',
  dot: 'node',
  opamp: 'opamp',
  op_amp: 'opamp',
  'op-amp': 'opamp',
  npn: 'npn',
  bjt: 'npn',
  bjt_npn: 'npn',
  npn_bjt: 'npn',
  transistor: 'npn',
  pnp: 'pnp',
  bjt_pnp: 'pnp',
  pnp_bjt: 'pnp',
  nmos: 'nmos',
  mos: 'nmos',
  mosfet: 'nmos',
  nmosfet: 'nmos',
  mosfet_n: 'nmos',
  n_mos: 'nmos',
  'n-mos': 'nmos',
  nfet: 'nmos',
  pmos: 'pmos',
  pmosfet: 'pmos',
  mosfet_p: 'pmos',
  p_mos: 'pmos',
  'p-mos': 'pmos',
  pfet: 'pmos',
};

function normalizeCoordPair(val: unknown): unknown {
  if (Array.isArray(val) && val.length >= 2) {
    return [Number(val[0]), Number(val[1])];
  }
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (obj.row !== undefined && obj.col !== undefined) {
      return [Number(obj.row), Number(obj.col)];
    }
    if (obj.r !== undefined && obj.c !== undefined) {
      return [Number(obj.r), Number(obj.c)];
    }
  }
  return val;
}

/**
 * Normalize minor LLM format variations into canonical DiagramSpec shape before Zod validation.
 */
export function normalizeRawDiagramSpecInput(raw: unknown, fallbackType?: string): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const src: Record<string, any> = { ...(raw as Record<string, any>) };

  if (!src.type && fallbackType) {
    src.type = fallbackType.trim().toLowerCase();
  }
  if (typeof src.type === 'string') {
    const t = src.type.trim().toLowerCase();
    if (t === 'grid' || t === 'grid_annot' || t === 'matrix') src.type = 'grid-annot';
    else if (t === 'plot' || t === 'plot2d' || t === 'function') src.type = 'plot2d';
    else if (t === 'flowchart' || t === 'fsm' || t === 'elk' || t === 'dag') src.type = 'graph';
    else if (t === 'wave' || t === 'timing' || t === 'bitfield') src.type = 'wavedrom';
    else if (t === 'schematic') src.type = 'circuit';
    else src.type = t;
  }

  if (src.type === 'grid-annot') {
    if (Array.isArray(src.highlights)) {
      src.highlights = src.highlights.map((h: any) =>
        h && typeof h === 'object' ? { ...h, tone: normalizeToneValue(h.tone) } : h
      );
    }
    if (Array.isArray(src.boxes)) {
      src.boxes = src.boxes.map((b: any) =>
        b && typeof b === 'object'
          ? {
              ...b,
              from: normalizeCoordPair(b.from),
              to: normalizeCoordPair(b.to),
              tone: normalizeToneValue(b.tone),
            }
          : b
      );
    }
    if (Array.isArray(src.arrows)) {
      src.arrows = src.arrows.map((a: any) =>
        a && typeof a === 'object'
          ? {
              ...a,
              from: normalizeCoordPair(a.from),
              to: normalizeCoordPair(a.to),
              tone: normalizeToneValue(a.tone),
            }
          : a
      );
    }
    if (Array.isArray(src.diagonals)) {
      src.diagonals = src.diagonals.map((d: any) =>
        d && typeof d === 'object'
          ? {
              ...d,
              cells: Array.isArray(d.cells) ? d.cells.map(normalizeCoordPair) : d.cells,
              tone: normalizeToneValue(d.tone),
            }
          : d
      );
    }
  } else if (src.type === 'plot2d') {
    if (!Array.isArray(src.functions) && Array.isArray(src.curves)) {
      src.functions = src.curves;
    }
    if (Array.isArray(src.functions)) {
      src.functions = src.functions.map((fn: any) =>
        fn && typeof fn === 'object' ? { ...fn, tone: normalizeToneValue(fn.tone) } : fn
      );
    }
    if (Array.isArray(src.shadedRegions)) {
      src.shadedRegions = src.shadedRegions.map((s: any) =>
        s && typeof s === 'object' ? { ...s, tone: normalizeToneValue(s.tone) } : s
      );
    }
    if (Array.isArray(src.points)) {
      src.points = src.points.map((p: any) =>
        p && typeof p === 'object' ? { ...p, tone: normalizeToneValue(p.tone) } : p
      );
    }
    if (Array.isArray(src.vlines)) {
      src.vlines = src.vlines.map((v: any) =>
        v && typeof v === 'object' ? { ...v, tone: normalizeToneValue(v.tone) } : v
      );
    }
    if (Array.isArray(src.hlines)) {
      src.hlines = src.hlines.map((h: any) =>
        h && typeof h === 'object' ? { ...h, tone: normalizeToneValue(h.tone) } : h
      );
    }
  } else if (src.type === 'graph') {
    if (typeof src.direction === 'string') {
      src.direction = src.direction.trim().toUpperCase();
    }
    if (Array.isArray(src.nodes)) {
      src.nodes = src.nodes.map((n: any) =>
        n && typeof n === 'object' ? { ...n, tone: normalizeToneValue(n.tone) } : n
      );
    }
    if (Array.isArray(src.edges)) {
      src.edges = src.edges.map((e: any) =>
        e && typeof e === 'object' ? { ...e, tone: normalizeToneValue(e.tone) } : e
      );
    }
  } else if (src.type === 'wavedrom') {
    const inner =
      (src.waveJson && typeof src.waveJson === 'object' ? src.waveJson : null) ||
      (src.data && typeof src.data === 'object' && !Array.isArray(src.data) ? src.data : null);
    if (inner) {
      if (!src.signal && inner.signal) src.signal = inner.signal;
      if (!src.reg && inner.reg) src.reg = inner.reg;
      if (!src.head && inner.head) src.head = inner.head;
      if (!src.foot && inner.foot) src.foot = inner.foot;
      if (!src.config && inner.config) src.config = inner.config;
      if (!src.edge && inner.edge) src.edge = inner.edge;
    }
  } else if (src.type === 'circuit') {
    if (!Array.isArray(src.elements) && Array.isArray(src.components)) {
      src.elements = src.components;
    }
    if (Array.isArray(src.elements)) {
      src.elements = src.elements.map((el: any) => {
        if (!el || typeof el !== 'object') return el;
        const rawKind = String(el.kind || el.type || '').trim().toLowerCase();
        let mappedKind = CIRCUIT_KIND_ALIAS_MAP[rawKind] || el.kind || el.type;
        const sub = String(el.subtype ?? el.variant ?? el.channel ?? el.polarityType ?? '')
          .trim()
          .toLowerCase();
        if (mappedKind === 'npn' && (rawKind === 'bjt' || rawKind === 'transistor') && (sub === 'pnp' || sub === 'p')) {
          mappedKind = 'pnp';
        } else if (mappedKind === 'nmos' && (rawKind === 'mos' || rawKind === 'mosfet') && sub.startsWith('p')) {
          mappedKind = 'pmos';
        }
        return {
          ...el,
          kind: mappedKind,
          pin: typeof el.pin === 'string' ? el.pin.trim().toLowerCase() : el.pin,
          fromAnchor: el.fromAnchor ?? el.from,
          toAnchor: el.toAnchor ?? el.to,
          tone: normalizeToneValue(el.tone),
        };
      });
    }
  }

  return src;
}

function formatZodError(error: z.ZodError): string {
  const issues = error.issues || [];
  if (issues.length === 0) return error.message || 'DiagramSpec 校验失败';
  return issues
    .slice(0, 4)
    .map((iss) => {
      const pathStr = iss.path && iss.path.length > 0 ? `${iss.path.join('.')}: ` : '';
      return `${pathStr}${iss.message}`;
    })
    .join('；');
}

export function validateDiagramSpec(
  raw: unknown,
  fallbackType?: string
): { success: true; data: DiagramSpec } | { success: false; error: string } {
  const normalized = normalizeRawDiagramSpecInput(raw, fallbackType);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return { success: false, error: 'diagramSpec 必须是非空 JSON 对象' };
  }

  const specType = (normalized as Record<string, unknown>).type;
  let result: z.ZodSafeParseResult<DiagramSpec>;
  switch (specType) {
    case 'grid-annot':
      result = GridAnnotSpecSchema.safeParse(normalized);
      break;
    case 'plot2d':
      result = Plot2dSpecSchema.safeParse(normalized);
      break;
    case 'graph':
      result = GraphSpecSchema.safeParse(normalized);
      break;
    case 'wavedrom':
      result = WaveDromSpecSchema.safeParse(normalized);
      break;
    case 'circuit':
      result = CircuitSpecSchema.safeParse(normalized);
      break;
    default:
      return {
        success: false,
        error: `未知或缺失 diagramSpec.type="${String(specType ?? '')}"（支持 grid-annot | plot2d | graph | wavedrom | circuit）`,
      };
  }

  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: formatZodError(result.error) };
}

export function isValidDiagramSpec(raw: unknown): raw is DiagramSpec {
  return validateDiagramSpec(raw).success;
}
