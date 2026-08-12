import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Edge,
  Handle,
  Node,
  Panel,
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
  NODE_WIDTH,
  colorKeyFor,
  generateColorMap,
  listCommonLabelKeys,
} from './CrossplaneGraph';

// Re-export for ResourceList.tsx
export type { ColorBy };
export { colorKeyFor, listCommonLabelKeys, generateColorMap };

const { Typography, Box, CircularProgress, Paper } =
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
      cursor: 'pointer',
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

// ── Custom map controls panel ─────────────────────────────────────────────────

interface GraphControlsProps {
  viewMode: 'detail' | 'groups';
  onViewModeChange: (m: 'detail' | 'groups') => void;
  direction: LayoutDirection;
  onDirectionChange: (d: LayoutDirection) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

function GraphControls({
  viewMode, onViewModeChange,
  direction, onDirectionChange,
  isExpanded, onToggleExpand,
  isFullscreen, onToggleFullscreen,
}: GraphControlsProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const btn = (active?: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, border: 'none', cursor: 'pointer',
    background: active ? '#1565c0' : '#fff',
    color: active ? '#fff' : '#555',
  });
  const sep:      React.CSSProperties = { height: 1, background: '#e0e0e0' };
  const thickSep: React.CSSProperties = { height: 2, background: '#d0d0d0', margin: '1px 0' };
  const rowSep:   React.CSSProperties = { width: 1, background: '#e0e0e0', alignSelf: 'stretch' };

  return (
    <Panel position="bottom-left" style={{ margin: '0 0 10px 10px' }}>
      <div style={{
        display: 'flex', flexDirection: 'column',
        borderRadius: 7, overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.14)',
        border: '1px solid #ddd', background: '#fff',
      }}>

        {/* Zoom in */}
        <button style={btn()} onClick={() => zoomIn({ duration: 150 })} title="Zoom in">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="6" y1="2" x2="6" y2="10"/><line x1="2" y1="6" x2="10" y2="6"/>
          </svg>
        </button>
        <div style={sep} />
        {/* Zoom out */}
        <button style={btn()} onClick={() => zoomOut({ duration: 150 })} title="Zoom out">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="2" y1="6" x2="10" y2="6"/>
          </svg>
        </button>
        <div style={sep} />
        {/* Fit view */}
        <button style={btn()} onClick={() => fitView({ duration: 200, padding: 0.15 })} title="Fit to view">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 4.5V1h3.5M7.5 1H11v3.5M1 7.5V11h3.5M7.5 11H11V7.5"/>
          </svg>
        </button>

        <div style={thickSep} />

        {/* View mode: graph | groups */}
        <div style={{ display: 'flex' }}>
          <button style={{ ...btn(viewMode === 'detail'), flex: 1 }} onClick={() => onViewModeChange('detail')} title="Dependency graph">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="6.5" cy="2.5" r="1.5"/>
              <circle cx="2.5" cy="10.5" r="1.5"/>
              <circle cx="10.5" cy="10.5" r="1.5"/>
              <line x1="6.5" y1="4" x2="2.5" y2="9"/>
              <line x1="6.5" y1="4" x2="10.5" y2="9"/>
            </svg>
          </button>
          <div style={rowSep} />
          <button style={{ ...btn(viewMode === 'groups'), flex: 1 }} onClick={() => onViewModeChange('groups')} title="Grouped summary">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
              <rect x="1" y="1" width="4" height="4" rx="1"/>
              <rect x="7" y="1" width="4" height="4" rx="1"/>
              <rect x="1" y="7" width="4" height="4" rx="1"/>
              <rect x="7" y="7" width="4" height="4" rx="1"/>
            </svg>
          </button>
        </div>

        {/* Layout direction */}
        <>
            <div style={sep} />
            <div style={{ display: 'flex' }}>
              <button style={{ ...btn(direction === 'TB'), flex: 1 }} onClick={() => onDirectionChange('TB')} title="Top → Bottom">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="6" y1="1" x2="6" y2="9"/><path d="M3 6.5l3 3 3-3"/>
                </svg>
              </button>
              <div style={rowSep} />
              <button style={{ ...btn(direction === 'LR'), flex: 1 }} onClick={() => onDirectionChange('LR')} title="Left → Right">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="6" x2="9" y2="6"/><path d="M6.5 3l3 3-3 3"/>
                </svg>
              </button>
            </div>
        </>

        <div style={thickSep} />

        {/* Expand + Fullscreen */}
        <div style={{ display: 'flex' }}>
          <button style={{ ...btn(isFullscreen), flex: 1 }} onClick={onToggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 1v4H1M11 5H7V1M5 11V7H1M11 7H7v4"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 5V1h4M7 1h4v4M1 7v4h4M7 11h4V7"/>
              </svg>
            )}
          </button>
          <div style={rowSep} />
          <button style={{ ...btn(), flex: 1 }} onClick={onToggleExpand} title={isExpanded ? 'Collapse' : 'Expand'}>
            {isExpanded ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7.5l3-3 3 3"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 4.5l3 3 3-3"/>
              </svg>
            )}
          </button>
        </div>

      </div>
    </Panel>
  );
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
  onGroupClick?: (item: FlatMR) => void;
  colorBy: ColorBy;
  labelKey: string | undefined;
  direction: LayoutDirection;
  onDirectionChange: (d: LayoutDirection) => void;
  viewMode: 'detail' | 'groups';
  onViewModeChange: (mode: 'detail' | 'groups') => void;
  colorMap: Record<string, string>;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

function ResourceGraphInner({
  items, loading, onNodeClick, onGroupClick,
  colorBy, labelKey, direction, onDirectionChange,
  viewMode, onViewModeChange, colorMap,
  isExpanded, onToggleExpand, isFullscreen, onToggleFullscreen,
}: InnerProps) {
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
          onNodeClick={(_: any, n: Node) => {
            if (n.type === 'cgGroupNode' && onGroupClick) {
              const item = (n.data as CgGroupData).firstItem;
              if (item) onGroupClick(item);
            }
          }}
        >
          <Background />
          <GraphControls
            viewMode={viewMode} onViewModeChange={onViewModeChange}
            direction={direction} onDirectionChange={onDirectionChange}
            isExpanded={isExpanded} onToggleExpand={onToggleExpand}
            isFullscreen={isFullscreen} onToggleFullscreen={onToggleFullscreen}
          />
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
  onGroupClick?: (item: FlatMR) => void;
  colorBy: ColorBy;
  labelKey?: string;
}


export function ResourceGraph({ items, loading, onNodeClick, onGroupClick, colorBy, labelKey }: ResourceGraphProps) {
  const [expanded,     setExpanded]     = useState(false);
  const [direction,    setDirection]    = useState<LayoutDirection>('TB');
  const [viewMode,     setViewMode]     = useState<'detail' | 'groups'>('groups');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <Paper elevation={1} style={{ marginBottom: 16, overflow: 'hidden', borderRadius: 8 }}>
      <div
        ref={containerRef}
        style={{ height: isFullscreen ? '100vh' : expanded ? 560 : 300, position: 'relative' as const }}
      >
        <ReactFlowProvider>
          <ResourceGraphInner
            items={items} loading={loading} onNodeClick={onNodeClick} onGroupClick={onGroupClick}
            colorBy={colorBy} labelKey={resolvedLabelKey}
            direction={direction} onDirectionChange={setDirection}
            viewMode={viewMode} onViewModeChange={setViewMode}
            colorMap={colorMap}
            isExpanded={expanded} onToggleExpand={() => setExpanded(v => !v)}
            isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}
          />
        </ReactFlowProvider>
      </div>
    </Paper>
  );
}
