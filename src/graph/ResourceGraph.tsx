import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Handle,
  Node,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { xpColors } from '../common/colors';
import { FlatMR } from '../helpers';
import {
  CgGroupData,
  CgNodeData,
  ColorBy,
  CrossplaneGraph,
  EdgePoint,
  GROUP_NODE_HEIGHT,
  LayoutDirection,
  NODE_HEIGHT,
  NODE_WIDTH,
  TIER_COLORS,
  colorKeyFor,
  generateColorMap,
  listCommonLabelKeys,
} from './CrossplaneGraph';

// Re-export for ResourceList.tsx
export type { ColorBy };
export { colorKeyFor, listCommonLabelKeys, generateColorMap };

const { Typography, Box, CircularProgress, Paper, MenuItem, TextField } =
  (window as any).pluginLib?.MuiCore ?? {};

// ── Detail node renderer ──────────────────────────────────────────────────────

const TIER_LABELS: Record<'xr' | 'claim' | 'providerconfig', string> = {
  xr:             'Composite Resource',
  claim:          'Claim',
  providerconfig: 'ProviderConfig',
};

function CgNode({ data }: { data: CgNodeData }) {
  const { name, kind, tier, borderColor, conditions, item, onNodeClick } = data;

  const ready  = conditions?.find(c => c.type === 'Ready');
  const synced = conditions?.find(c => c.type === 'Synced');
  const isOk    = ready?.status === 'True' && synced?.status === 'True';
  const isError = ready?.status === 'False' || synced?.status === 'False';

  const dotColor =
    tier === 'mr'
      ? isOk    ? xpColors.healthy.bg
      : isError ? xpColors.degraded.bg
                : xpColors.warning.bg
      : borderColor;

  const tierLabel = tier !== 'mr' ? TIER_LABELS[tier as keyof typeof TIER_LABELS] : undefined;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', height: '100%',
        padding: '0 10px', boxSizing: 'border-box' as const,
        overflow: 'hidden', gap: 8,
        cursor: tier === 'mr' && onNodeClick ? 'pointer' : 'default',
        fontFamily: 'var(--sapFontFamily, inherit)',
      }}
      onClick={tier === 'mr' && item && onNodeClick ? () => onNodeClick(item) : undefined}
    >
      <Handle type="target" position={Position.Top}    style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />

      {/* Status / tier indicator */}
      <span style={{
        width: 10, height: 10, flexShrink: 0,
        borderRadius: tier === 'mr' ? '50%' : 2,
        background: dotColor,
        opacity: tier === 'mr' ? 1 : 0.75,
        boxShadow: tier === 'mr' ? `0 0 0 3px ${dotColor}33` : 'none',
      }} />

      {/* Text */}
      <div style={{ overflow: 'hidden', flex: 1 }}>
        {tierLabel && (
          <div style={{
            fontSize: 10, opacity: 0.55, marginBottom: 1,
            fontWeight: 600, letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
            whiteSpace: 'nowrap' as const,
          }}>
            {tierLabel}
          </div>
        )}
        <div style={{
          fontWeight: 600, fontSize: 13,
          whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {name}
        </div>
        <div style={{
          fontSize: 11, opacity: 0.55, marginTop: 1,
          whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {kind}
        </div>
      </div>
    </div>
  );
}

// ── Group node renderer ───────────────────────────────────────────────────────

function CgGroupNode({ data }: { data: CgGroupData }) {
  const { key, count, healthyCount, brokenCount, unknownCount } = data;
  const hasErrors  = brokenCount > 0;
  const allHealthy = brokenCount === 0 && unknownCount === 0 && count > 0;
  const dotColor   = hasErrors ? xpColors.degraded.bg : allHealthy ? xpColors.healthy.bg : xpColors.warning.bg;
  const healthyPct = count > 0 ? (healthyCount / count) * 100 : 0;
  const brokenPct  = count > 0 ? (brokenCount  / count) * 100 : 0;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      height: '100%', padding: '10px 12px', boxSizing: 'border-box' as const,
      fontFamily: 'var(--sapFontFamily, inherit)',
    }}>
      <Handle type="target" position={Position.Top}    style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />

      {/* Name + count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
        <span style={{
          width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
          background: dotColor, boxShadow: `0 0 0 3px ${dotColor}33`,
        }} />
        <span style={{
          fontWeight: 700, fontSize: 13, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
        }}>
          {key}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 600, color: '#555',
          background: '#ebebeb', borderRadius: 10, padding: '1px 7px', flexShrink: 0,
        }}>
          {count}
        </span>
      </div>

      {/* Ratio bar */}
      <div style={{
        height: 5, borderRadius: 3, background: '#e0e0e0',
        overflow: 'hidden', display: 'flex', marginBottom: 5,
      }}>
        {healthyCount > 0 && (
          <div style={{ width: `${healthyPct}%`, background: xpColors.healthy.bg }} />
        )}
        {brokenCount > 0 && (
          <div style={{ width: `${brokenPct}%`, background: xpColors.degraded.bg }} />
        )}
      </div>

      {/* Stats */}
      <div style={{ fontSize: 10, display: 'flex', gap: 8 }}>
        {healthyCount > 0 && <span style={{ color: xpColors.healthy.bg }}>{healthyCount} healthy</span>}
        {brokenCount  > 0 && <span style={{ color: xpColors.degraded.bg }}>{brokenCount} broken</span>}
        {unknownCount > 0 && <span style={{ color: '#888' }}>{unknownCount} pending</span>}
        {count === 0       && <span style={{ color: '#bbb' }}>—</span>}
      </div>
    </div>
  );
}

// ── Orthogonal edge (ELK bend-point renderer) ─────────────────────────────────

function OrthogonalEdge(props: any) {
  const { sourceX, sourceY, targetX, targetY, markerEnd, style, data } = props;
  const points: EdgePoint[] =
    data?.points?.length >= 2
      ? data.points
      : [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
  const d = points.map((p: EdgePoint, i: number) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  return (
    <path
      d={d} fill="none"
      stroke={style?.stroke ?? '#888'} strokeWidth={style?.strokeWidth ?? 2}
      strokeDasharray={style?.strokeDasharray} opacity={style?.opacity ?? 1}
      markerEnd={markerEnd}
    />
  );
}

// ── FitView helper ────────────────────────────────────────────────────────────

function FitOnChange({ nodes, direction }: { nodes: Node[]; direction: LayoutDirection }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!nodes.length) return;
    const id = requestAnimationFrame(() => fitView({ duration: 200, padding: 0.15 }));
    return () => cancelAnimationFrame(id);
  }, [nodes, direction, fitView]);
  return null;
}

// ── ReactFlow type registries ─────────────────────────────────────────────────

const nodeTypes = {
  cgNode:      ({ data }: { data: CgNodeData  }) => <CgNode      data={data} />,
  cgGroupNode: ({ data }: { data: CgGroupData }) => <CgGroupNode data={data} />,
};

const edgeTypes = { orth: OrthogonalEdge };

// ── Inner canvas component ────────────────────────────────────────────────────

interface InnerProps {
  items: FlatMR[];
  loading: boolean;
  onNodeClick: (item: FlatMR) => void;
  colorBy: ColorBy;
  labelKey: string | undefined;
  direction: LayoutDirection;
  viewMode: 'detail' | 'groups';
  colorMap: Record<string, string>;
}

function ResourceGraphInner({ items, loading, onNodeClick, colorBy, labelKey, direction, viewMode, colorMap }: InnerProps) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const [layoutDone, setLayoutDone] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const graph = useMemo(() => new CrossplaneGraph(items, onNodeClick), [items, onNodeClick]);

  useEffect(() => {
    if (loading) {
      setRfNodes([]); setRfEdges([]); setLayoutDone(false); return;
    }

    if (!graph.nodes.length) {
      setRfNodes([]); setRfEdges([]); setLayoutDone(false); return;
    }

    setLayoutDone(false);
    let cancelled = false;

    const layoutFn =
      viewMode === 'groups'
        ? graph.layoutGrouped({ colorBy, labelKey, colorMap, direction })
        : graph.layout({ colorBy, labelKey, colorMap, direction });

    layoutFn.then(({ nodes, edges }) => {
      if (cancelled) return;
      setRfNodes(nodes as any); setRfEdges(edges); setLayoutDone(true);
    }).catch(err => {
      console.error('ResourceGraph layout failed', err);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, colorBy, labelKey, colorMap, direction, viewMode]);

  // Hover: connected nodes stay full opacity, others fade (detail mode only)
  const connectedIds = useMemo(() => {
    if (!hoveredId || viewMode === 'groups') return null;
    const s = new Set<string>([hoveredId]);
    rfEdges.forEach(e => {
      if (e.source === hoveredId) s.add(e.target);
      if (e.target === hoveredId) s.add(e.source);
    });
    return s;
  }, [hoveredId, rfEdges, viewMode]);

  const displayNodes = useMemo(() =>
    !connectedIds ? rfNodes :
      rfNodes.map(n => connectedIds.has(n.id) ? n : { ...n, style: { ...n.style, opacity: 0.15 } }),
    [rfNodes, connectedIds],
  );

  const displayEdges = useMemo(() => {
    if (!hoveredId || viewMode === 'groups') return rfEdges;
    return rfEdges.map(e => {
      if (e.target === hoveredId)
        return { ...e, animated: true, style: { ...e.style, stroke: '#0070f2', strokeWidth: 2.5, opacity: 1 } };
      if (e.source === hoveredId)
        return { ...e, animated: true, style: { ...e.style, stroke: '#e76500', strokeWidth: 2.5, opacity: 1 } };
      return { ...e, style: { ...e.style, opacity: 0.1 } };
    });
  }, [rfEdges, hoveredId, viewMode]);

  const isEmpty = !loading && items.length === 0;

  return (
    <>
      {(loading || (!layoutDone && items.length > 0)) && (
        <Box display="flex" alignItems="center" justifyContent="center" gap={1}
          style={{ position: 'absolute' as const, inset: 0, background: 'rgba(255,255,255,0.8)', zIndex: 10 }}>
          <CircularProgress size={18} />
          <Typography variant="body2">Building graph…</Typography>
        </Box>
      )}
      {isEmpty ? (
        <Box display="flex" alignItems="center" justifyContent="center" style={{ height: '100%' }}>
          <Typography variant="body2" color="textSecondary">No resources match the current filters.</Typography>
        </Box>
      ) : (
        <ReactFlow
          nodes={displayNodes} edges={displayEdges}
          nodeTypes={nodeTypes as any} edgeTypes={edgeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          defaultEdgeOptions={{ style: { stroke: '#888', strokeWidth: 1.5, opacity: 0.5 } }}
          fitView minZoom={0.05} maxZoom={4}
          nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          onNodeMouseEnter={(_: any, n: Node) => setHoveredId(n.id)}
          onNodeMouseLeave={() => setHoveredId(null)}
        >
          <Background />
          <Controls showInteractive={false} />
          <FitOnChange nodes={rfNodes} direction={direction} />
        </ReactFlow>
      )}
    </>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export interface ResourceGraphProps {
  items: FlatMR[];
  loading: boolean;
  onNodeClick: (item: FlatMR) => void;
  colorBy: ColorBy;
  labelKey?: string;
}

const DIRECTION_OPTIONS: { value: LayoutDirection; label: string }[] = [
  { value: 'TB', label: 'Top → Bottom' },
  { value: 'LR', label: 'Left → Right' },
];

const COLOR_BY_OPTIONS: { value: ColorBy; label: string }[] = [
  { value: 'provider', label: 'ProviderConfig' },
  { value: 'source',   label: 'Provider type'  },
  { value: 'flux',     label: 'Flux release'   },
  { value: 'label',    label: 'Label'          },
  { value: 'kind',     label: 'Kind'           },
];

export function ResourceGraph({ items, loading, onNodeClick, colorBy, labelKey }: ResourceGraphProps) {
  const [expanded,   setExpanded]   = useState(false);
  const [direction,  setDirection]  = useState<LayoutDirection>('TB');
  const [viewMode,   setViewMode]   = useState<'detail' | 'groups'>('groups');
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onChange = () => setIsFullscreen(document.fullscreenElement === el);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else containerRef.current?.requestFullscreen().catch(() => {});
  };

  const availableLabelKeys = useMemo(() => listCommonLabelKeys(items), [items]);
  const resolvedLabelKey   = useMemo(() =>
    colorBy !== 'label' ? undefined :
    labelKey && availableLabelKeys.includes(labelKey) ? labelKey : availableLabelKeys[0],
    [colorBy, labelKey, availableLabelKeys],
  );

  const colorMap = useMemo(() => generateColorMap(items, colorBy, resolvedLabelKey), [items, colorBy, resolvedLabelKey]);

  // Status legend
  const statusLegend = [
    { color: xpColors.healthy.bg,  label: 'Ready & Synced' },
    { color: xpColors.degraded.bg, label: 'Not Ready / Not Synced' },
    { color: xpColors.warning.bg,  label: 'Unknown' },
  ];

  // Tier legend (detail mode only)
  const tierLegend = [
    { color: TIER_COLORS.claim,          label: 'Claim' },
    { color: TIER_COLORS.xr,             label: 'Composite Resource' },
    { color: TIER_COLORS.providerconfig, label: 'ProviderConfig' },
  ];

  const colorLegend = Object.entries(colorMap).map(([name, color]) => ({ name, color }));

  return (
    <Paper elevation={1} style={{ marginBottom: 16, overflow: 'hidden' }}>
      {/* Header toolbar */}
      <Box
        px={2} py={1}
        display="flex" alignItems="center" justifyContent="space-between"
        style={{ borderBottom: '1px solid #e0e0e0', background: '#fafafa', gap: 8, flexWrap: 'wrap' as const }}
      >
        <Box display="flex" alignItems="center" gap={1.5} flexWrap="wrap">
          <Typography variant="subtitle2">Dependency Graph</Typography>

          {/* Direction selector — detail mode only */}
          {viewMode === 'detail' && (
            <TextField select size="small" value={direction}
              onChange={(e: any) => setDirection(e.target.value)}
              label="Layout" style={{ minWidth: 130 }}>
              {DIRECTION_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </TextField>
          )}

          {/* Status dots */}
          <Box display="flex" alignItems="center" gap={1}>
            {statusLegend.map(({ color, label }) => (
              <Box key={label} display="flex" alignItems="center" gap={0.5}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
                <Typography variant="caption" color="textSecondary">{label}</Typography>
              </Box>
            ))}
          </Box>

          {/* Tier squares — detail mode only */}
          {viewMode === 'detail' && (
            <Box display="flex" alignItems="center" gap={1} ml={0.5}>
              <Typography variant="caption" color="textSecondary" style={{ opacity: 0.35 }}>|</Typography>
              {tierLegend.map(({ color, label }) => (
                <Box key={label} display="flex" alignItems="center" gap={0.5}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block', flexShrink: 0 }} />
                  <Typography variant="caption" color="textSecondary">{label}</Typography>
                </Box>
              ))}
            </Box>
          )}

          {/* Dynamic color legend */}
          {colorLegend.length > 0 && (
            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
              <Typography variant="caption" color="textSecondary" style={{ opacity: 0.35 }}>|</Typography>
              {colorLegend.map(({ name, color }) => (
                <Box key={name} display="flex" alignItems="center" gap={0.5}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block', flexShrink: 0 }} />
                  <Typography variant="caption" color="textSecondary">{name}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {/* Right controls */}
        <Box display="flex" alignItems="center" gap={1}>
          {/* View mode toggle */}
          <span
            onClick={() => setViewMode(v => v === 'detail' ? 'groups' : 'detail')}
            style={{ cursor: 'pointer', fontSize: 12, color: '#1565c0', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}
            title={viewMode === 'detail' ? 'Switch to grouped summary view' : 'Switch to dependency graph view'}
          >
            {viewMode === 'detail' ? '⊟ Group View' : '⊞ Graph View'}
          </span>
          <span
            onClick={toggleFullscreen}
            style={{ cursor: 'pointer', fontSize: 12, color: '#666', userSelect: 'none' as const }}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? '⊡' : '⊞'}
          </span>
          <span
            onClick={() => setExpanded(v => !v)}
            style={{ cursor: 'pointer', fontSize: 12, color: '#1565c0', whiteSpace: 'nowrap' as const, userSelect: 'none' as const }}
          >
            {expanded ? '▴ Collapse' : '▾ Expand'}
          </span>
        </Box>
      </Box>

      {/* Canvas */}
      <div ref={containerRef} style={{ height: isFullscreen ? '100vh' : expanded ? 560 : 300, position: 'relative' as const }}>
        <ReactFlowProvider>
          <ResourceGraphInner
            items={items} loading={loading} onNodeClick={onNodeClick}
            colorBy={colorBy} labelKey={resolvedLabelKey}
            direction={direction} viewMode={viewMode}
            colorMap={colorMap}
          />
        </ReactFlowProvider>
      </div>
    </Paper>
  );
}
