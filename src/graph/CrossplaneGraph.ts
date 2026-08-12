/**
 * Data model for the Crossplane resource dependency graph.
 *
 * Ported from ui-frontend/src/components/Graphs/Graph.model.ts and adapted
 * for standard Crossplane annotations instead of BTP-specific *Ref fields.
 *
 * Relationship discovery:
 *   metadata.annotations['crossplane.io/composite']        → MR is owned by an XR   (primary edge)
 *   metadata.annotations['crossplane.io/claim-name/ns']    → XR is claimed by Claim  (primary edge)
 *   spec.providerConfigRef.name                            → MR uses a ProviderConfig (aux/dashed edge)
 */

import ELK from 'elkjs/lib/elk.bundled.js';
import { Edge, MarkerType, Node, Position } from 'reactflow';
import { FlatMR } from '../helpers';

// ── Public types ──────────────────────────────────────────────────────────────

export type ColorBy = 'provider' | 'source' | 'flux' | 'label';
export type LayoutDirection = 'TB' | 'LR';
export type EdgePoint = { x: number; y: number };

export interface CgNodeData extends Record<string, unknown> {
  id: string;
  name: string;
  kind: string;
  tier: 'mr' | 'xr' | 'claim' | 'providerconfig';
  borderColor: string;
  conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
  item?: FlatMR;
  onNodeClick?: (item: FlatMR) => void;
}

export interface EdgeSpec {
  id: string;
  source: string;
  target: string;
  aux: boolean;
}

export interface LayoutOptions {
  colorBy: ColorBy;
  labelKey?: string;
  colorMap: Record<string, string>;
  direction: LayoutDirection;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 62;

// Fixed border colors for synthetic tier nodes
export const TIER_COLORS: Record<'xr' | 'claim' | 'providerconfig', string> = {
  xr: '#1565c0',
  claim: '#7b1fa2',
  providerconfig: '#546e7a',
};

// Matching ui-frontend's 14-color palette
const COLORS: readonly string[] = [
  '#FFC933', '#FF8AF0', '#FEADC8', '#2CE0BF',
  '#FF8CB2', '#B894FF', '#049F9A', '#FA4F96',
  '#F31DED', '#7858FF', '#07838F', '#DF1278',
  '#510080', '#5D36FF',
];

const SYSTEM_LABEL_PREFIXES: readonly string[] = [
  'app.kubernetes.io/', 'kubernetes.io/', 'helm.sh/', 'crossplane.io/', 'pod-template-hash',
];

// Full ELK config from ui-frontend (richer spacing than the previous minimal config)
const ELK_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.spacing.nodeNodeBetweenLayers': '100',
  'elk.layered.spacing.edgeNodeBetweenLayers': '50',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
  'elk.spacing.nodeNode': '80',
  'elk.spacing.componentComponent': '120',
  'elk.spacing.edgeNode': '30',
  'elk.spacing.edgeEdge': '20',
  'elk.spacing.portPort': '20',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.mergeEdges': 'true',
  'elk.layered.mergeHierarchyEdges': 'true',
};

const elkSingleton = new ELK();

// ── Pure helpers (exported for ResourceList.tsx) ──────────────────────────────

function isSystemLabel(key: string): boolean {
  return SYSTEM_LABEL_PREFIXES.some(p => (p.endsWith('/') ? key.startsWith(p) : key === p));
}

function providerTypeFromApiVersion(apiVersion: string): string {
  return apiVersion?.split('/')[0] || 'unknown';
}

export function colorKeyFor(item: FlatMR, colorBy: ColorBy, labelKey?: string): string {
  switch (colorBy) {
    case 'source':
      return providerTypeFromApiVersion(item.apiVersion ?? '');
    case 'flux': {
      const labels: Record<string, string> = (item.metadata?.labels as Record<string, string>) ?? {};
      const k = Object.keys(labels).find(lk => lk.endsWith('/name'));
      return k ? labels[k] : 'default';
    }
    case 'label':
      return (labelKey && (item.metadata?.labels as Record<string, string>)?.[labelKey]) || 'default';
    default:
      return item.spec?.providerConfigRef?.name ?? 'default';
  }
}

export function generateColorMap(items: FlatMR[], colorBy: ColorBy, labelKey?: string): Record<string, string> {
  const keys = Array.from(new Set(items.map(i => colorKeyFor(i, colorBy, labelKey))));
  const map: Record<string, string> = {};
  keys.forEach((k, i) => {
    map[k] =
      (colorBy === 'flux' || colorBy === 'label') && k === 'default'
        ? '#BFBFBF'
        : COLORS[i % COLORS.length];
  });
  return map;
}

export function listCommonLabelKeys(items: FlatMR[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const labels: Record<string, string> = (item.metadata?.labels as Record<string, string>) ?? {};
    Object.keys(labels).forEach(k => {
      if (isSystemLabel(k)) return;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k);
}

// ── CrossplaneGraph class ─────────────────────────────────────────────────────

export class CrossplaneGraph {
  readonly nodes: CgNodeData[];
  readonly nodeById: Map<string, CgNodeData>;
  private readonly edgeSpecs: EdgeSpec[];

  constructor(items: FlatMR[], onNodeClick: (item: FlatMR) => void) {
    const nodeMap = new Map<string, CgNodeData>();
    const edgeSpecs: EdgeSpec[] = [];
    const emittedEdges = new Set<string>();

    const ensureNode = (id: string, data: CgNodeData) => {
      if (!nodeMap.has(id)) nodeMap.set(id, data);
    };

    const addEdge = (source: string, target: string, aux: boolean) => {
      const key = `${source}→${target}`;
      if (emittedEdges.has(key)) return;
      emittedEdges.add(key);
      edgeSpecs.push({ id: key, source, target, aux });
    };

    for (const item of items) {
      const mrName = item.metadata?.name ?? '';
      if (!mrName) continue;
      const mrNs = item.metadata?.namespace ?? '';
      const mrId = `mr:${item._group}/${item._plural}/${mrNs ? mrNs + '/' : ''}${mrName}`;

      ensureNode(mrId, {
        id: mrId,
        name: mrName,
        kind: item._kind ?? item._plural,
        tier: 'mr',
        borderColor: '#888',  // overwritten in layout()
        conditions: (item.status?.conditions ?? []) as CgNodeData['conditions'],
        item,
        onNodeClick,
      });

      const ann = item.metadata?.annotations as Record<string, string> | undefined;

      // XR → MR (primary)
      const xrName = ann?.['crossplane.io/composite'] ?? '';
      if (xrName) {
        const xrId = `xr:${xrName}`;
        ensureNode(xrId, {
          id: xrId, name: xrName, kind: 'CompositeResource',
          tier: 'xr', borderColor: TIER_COLORS.xr, conditions: [],
        });
        addEdge(xrId, mrId, false);

        // Claim → XR (primary)
        const claimName = ann?.['crossplane.io/claim-name'] ?? '';
        const claimNs = ann?.['crossplane.io/claim-namespace'] ?? '';
        if (claimName) {
          const claimKey = claimNs ? `${claimNs}/${claimName}` : claimName;
          const claimId = `claim:${claimKey}`;
          ensureNode(claimId, {
            id: claimId, name: claimKey, kind: 'Claim',
            tier: 'claim', borderColor: TIER_COLORS.claim, conditions: [],
          });
          addEdge(claimId, xrId, false);
        }
      }

      // MR → ProviderConfig (aux / dashed)
      const pcName = item.spec?.providerConfigRef?.name ?? 'default';
      const pcId = `pconfig:${pcName}`;
      ensureNode(pcId, {
        id: pcId, name: pcName, kind: 'ProviderConfig',
        tier: 'providerconfig', borderColor: TIER_COLORS.providerconfig, conditions: [],
      });
      addEdge(mrId, pcId, true);
    }

    // Second pass: BTP-style spec.forProvider.*Ref edges
    // e.g. ServiceInstance has subaccountRef + serviceManagerRef → primary edges to those MRs
    const mrNodeByName = new Map<string, string>();
    for (const [id, node] of nodeMap) {
      if (node.tier === 'mr') mrNodeByName.set(node.name, id);
    }
    for (const item of items) {
      const mrName = item.metadata?.name ?? '';
      if (!mrName) continue;
      const mrNs = item.metadata?.namespace ?? '';
      const mrId = `mr:${item._group}/${item._plural}/${mrNs ? mrNs + '/' : ''}${mrName}`;

      const forProvider = item.spec?.forProvider as Record<string, unknown> | undefined;
      if (!forProvider) continue;
      for (const [key, val] of Object.entries(forProvider)) {
        if (!key.endsWith('Ref') || !val || typeof val !== 'object') continue;
        const refName = (val as Record<string, unknown>).name;
        if (typeof refName !== 'string' || !refName) continue;
        const targetId = mrNodeByName.get(refName);
        if (!targetId || targetId === mrId) continue;
        addEdge(mrId, targetId, false);
      }
    }

    this.nodes = Array.from(nodeMap.values());
    this.nodeById = new Map(this.nodes.map(n => [n.id, n]));
    this.edgeSpecs = edgeSpecs;
  }

  async layout({ colorBy, labelKey, colorMap, direction }: LayoutOptions): Promise<{
    nodes: Node<CgNodeData>[];
    edges: Edge[];
  }> {
    if (!this.nodes.length) return { nodes: [], edges: [] };

    const dir =
      direction === 'LR'
        ? { elk: 'RIGHT', source: Position.Right, target: Position.Left }
        : { elk: 'DOWN',  source: Position.Bottom, target: Position.Top };

    const primary = this.edgeSpecs.filter(e => !e.aux);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const laid: any = await elkSingleton.layout({
      id: 'root',
      layoutOptions: { ...ELK_OPTIONS, 'elk.direction': dir.elk },
      children: this.nodes.map(n => ({ id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
      edges: [
        ...primary.map(e => ({ id: e.id, sources: [e.source], targets: [e.target], layoutOptions: { 'elk.priority': '10' } })),
      ],
    });

    const posById = new Map<string, { x: number; y: number }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (laid.children ?? []).forEach((c: any) => posById.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 }));

    const nodes: Node<CgNodeData>[] = this.nodes.map(n => {
      const pos = posById.get(n.id) ?? { x: 0, y: 0 };
      const borderColor =
        n.tier !== 'mr'
          ? TIER_COLORS[n.tier as keyof typeof TIER_COLORS]
          : (colorMap[n.item ? colorKeyFor(n.item, colorBy, labelKey) : 'default'] ?? '#888');

      const isErrorMR = n.tier === 'mr' &&
        n.conditions?.some(c => (c.type === 'Ready' || c.type === 'Synced') && c.status === 'False');

      return {
        id: n.id,
        type: 'cgNode',
        data: { ...n, borderColor },
        style: {
          border: `2px solid ${borderColor}`,
          borderRadius: 8,
          backgroundColor: isErrorMR ? '#fff5f5' : '#ffffff',
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        },
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        position: pos,
        sourcePosition: dir.source as Position,
        targetPosition: dir.target as Position,
      };
    });

    const primaryIds = new Set(primary.map(e => e.id));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const primaryEdges: Edge[] = (laid.edges ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((le: any) => primaryIds.has(le.id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((le: any) => {
        const spec = primary.find(e => e.id === le.id);
        const section = le.sections?.[0];
        const points: EdgePoint[] = section
          ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
          : [];
        return {
          id: le.id,
          source: spec?.source ?? '',
          target: spec?.target ?? '',
          type: 'orth',
          data: { points, aux: false },
          style: { strokeWidth: 2, stroke: '#888' },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#888', width: 12, height: 12 } as any,
        } as Edge;
      });

    return { nodes, edges: primaryEdges };
  }
}
