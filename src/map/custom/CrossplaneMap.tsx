import '@xyflow/react/dist/style.css';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { SectionHeader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, CircularProgress, Container, Paper, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  Panel,
  ReactFlow,
  useNodesState,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { openManagedDetail } from '../../managed/ManagedDetail';
import { ManagedGraphErrors } from '../common/ManagedGraphErrors';
import type { GraphNode } from '../common/types';
import { useManagedGraph } from '../common/useManagedGraph';
import {
  categoryFieldsFromKubeObject,
  CategoryKey,
  categoryKeyOf,
  categoryLabelOf,
  CategoryMode,
  collectLabelKeys,
  generateCategoryColorMap,
} from './graphCategories';
import { getGraphCollapseState } from './graphCollapse';
import { GraphControls, StatusFilter } from './GraphControls';
import { GraphLayoutInput, layoutGraph } from './layoutGraph';
import type { ResourceNodeData } from './ResourceNode';
import { ResourceNode } from './ResourceNode';
import {
  NAMESPACE_LINE_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
  PANEL_ELEVATION,
  PANEL_SX,
} from './styles';
import { useAnimatedGraphVisibility } from './useAnimatedGraphVisibility';

function CrossplaneMapView() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const canvasBackground = isDark
    ? theme.palette.background.default
    : theme.palette.background.muted ?? theme.palette.grey[100];
  // Opaque paint keeps arrowheads and overlapping edges at a uniform contrast.
  const edgeStroke = theme.palette.grey[600];
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const fadeDuration = theme.transitions.duration.shortest;
  const graph = useManagedGraph();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const nodeTypes = useMemo(() => ({ resource: ResourceNode }), []);
  const resourcesById = useMemo(
    () => new Map((graph?.nodes ?? []).map(resource => [resource.id, resource])),
    [graph?.nodes]
  );
  const nextLayoutInput = useMemo<GraphLayoutInput | null>(
    () =>
      graph
        ? {
            nodes: graph.nodes.map(node => {
              const namespace =
                node.kubeObject?.metadata?.namespace ??
                node.kubeObject?.jsonData?.metadata?.namespace;
              return {
                id: node.id,
                width: NODE_WIDTH,
                height: NODE_HEIGHT + (namespace ? NAMESPACE_LINE_HEIGHT : 0),
              };
            }),
            edges: graph.edges,
          }
        : null,
    [graph]
  );
  const [layoutInput, setLayoutInput] = useState(nextLayoutInput);
  // Keep the running layout valid when only live resource data or list order changes.
  if (!hasSameLayoutInput(layoutInput, nextLayoutInput)) {
    setLayoutInput(nextLayoutInput);
  }

  // Selection follows the detail action; a background click clears it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // Categorize-by mode + selected label key. State only (no persistence). All
  // hooks below run before the loading early-return to keep hook order stable.
  const [categoryMode, setCategoryMode] = useState<CategoryMode>('provider');
  const [labelKey, setLabelKey] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<{
    categoryMode: CategoryMode;
    labelKey: string;
    values: CategoryKey[];
  } | null>(null);

  const categoryFields = useMemo(
    () => (graph?.nodes ?? []).map(node => categoryFieldsFromKubeObject(node.kubeObject)),
    [graph]
  );
  const labelKeys = useMemo(() => collectLabelKeys(categoryFields), [categoryFields]);
  // Fall back when the chosen key is empty or no longer present in the data.
  const effectiveLabelKey =
    labelKey && labelKeys.includes(labelKey) ? labelKey : labelKeys[0] ?? '';
  const categoryColorMap = useMemo(
    () =>
      generateCategoryColorMap(categoryFields, categoryMode, theme.palette.mode, effectiveLabelKey),
    [categoryFields, categoryMode, theme.palette.mode, effectiveLabelKey]
  );
  const categoryOptions = useMemo(() => [...categoryColorMap.keys()], [categoryColorMap]);
  const selectedCategories =
    categoryFilter?.categoryMode === categoryMode &&
    (categoryMode !== 'label' || categoryFilter.labelKey === effectiveLabelKey)
      ? categoryFilter.values
      : null;
  const categoryHiddenIds = useMemo(() => {
    if (selectedCategories === null || categoryMode === 'none') return new Set<string>();
    const selectedValues = new Set(selectedCategories);
    return new Set(
      (graph?.nodes ?? [])
        .filter(
          node =>
            !selectedValues.has(
              categoryKeyOf(
                categoryFieldsFromKubeObject(node.kubeObject),
                categoryMode,
                effectiveLabelKey
              )
            )
        )
        .map(node => node.id)
    );
  }, [graph, selectedCategories, categoryMode, effectiveLabelKey]);
  const { childrenById, targetHiddenIds, hasFilterMatches } = useMemo(() => {
    const sourceNodes = graph?.nodes ?? [];
    const matchingNodes = sourceNodes.filter(
      node =>
        !categoryHiddenIds.has(node.id) && (statusFilter === 'all' || node.status === statusFilter)
    );
    // A filtered-out parent must not keep matching descendants collapsed and unreachable.
    const { childrenById, hiddenIds: collapsedHiddenIds } = getGraphCollapseState(
      matchingNodes,
      graph?.edges ?? [],
      collapsedIds
    );
    const visibleIds = new Set(
      matchingNodes.filter(node => !collapsedHiddenIds.has(node.id)).map(node => node.id)
    );
    return {
      childrenById,
      targetHiddenIds: new Set(
        sourceNodes.filter(node => !visibleIds.has(node.id)).map(node => node.id)
      ),
      hasFilterMatches: matchingNodes.length > 0,
    };
  }, [graph, categoryHiddenIds, statusFilter, collapsedIds]);
  const animatedVisibility = useAnimatedGraphVisibility(
    targetHiddenIds,
    reduceMotion,
    fadeDuration
  );

  const openDetails = useCallback((node: GraphNode) => {
    setSelectedId(node.id);

    const ko = node.kubeObject;
    const crd = node.customResourceDefinition;
    const item = ko?.jsonData ?? ko ?? {};
    const kind: string = item.kind ?? '';
    const name: string = item.metadata?.name ?? '';
    const namespace: string | undefined = item.metadata?.namespace;
    const [group = '', version] = (item.apiVersion ?? '').split('/');
    // customResourceDefinition is "plural.group"; plural is everything before it.
    const plural: string = crd && group ? crd.slice(0, crd.length - group.length - 1) : '';

    if (!name || !group || !plural) return;

    openManagedDetail({
      providerName: node.providerName,
      group,
      version,
      plural,
      name,
      namespace,
      title: `${kind || 'Resource'} ${name}`,
      hideTitleInHeader: true,
    });
  }, []);

  useEffect(() => {
    if (!layoutInput) return;

    // Pending discovery is null; an empty collection is a completed result.
    if (layoutInput.nodes.length === 0) {
      setNodes([]);
      setSelectedId(null);
      setCollapsedIds(new Set());
      return;
    }

    let cancelled = false;
    layoutGraph(layoutInput).then(positions => {
      if (cancelled) return;
      setNodes(current => {
        const currentById = new Map(current.map(node => [node.id, node]));
        return [...positions].map(([id, position]) => ({
          ...currentById.get(id),
          id,
          position,
          data: {},
        }));
      });
    });

    return () => {
      cancelled = true;
    };
  }, [layoutInput, setNodes]);

  // Current resource data is independent of the last completed layout.
  const displayNodes = useMemo<Node<ResourceNodeData>[]>(
    () =>
      nodes.flatMap(node => {
        const resource = resourcesById.get(node.id);
        if (!resource) return [];
        const ko = resource.kubeObject ?? {};
        const key = categoryKeyOf(
          categoryFieldsFromKubeObject(ko),
          categoryMode,
          effectiveLabelKey
        );
        const categorized = categoryMode !== 'none';
        return [
          {
            ...node,
            type: 'resource',
            // The card's native buttons own focus and selection.
            selectable: false,
            focusable: false,
            ariaRole: 'group',
            hidden: animatedVisibility.hiddenIds.has(node.id),
            className: animatedVisibility.transparentIds.has(node.id)
              ? 'crossplane-map-fading'
              : undefined,
            domAttributes: {
              ...node.domAttributes,
              'aria-describedby': undefined,
              'aria-hidden': targetHiddenIds.has(node.id) || undefined,
              // Inert also excludes the card's native buttons during their exit fade.
              inert: targetHiddenIds.has(node.id) ? '' : undefined,
            },
            selected: node.id === selectedId,
            data: {
              kind: ko.kind ?? ko.jsonData?.kind ?? 'Resource',
              name: ko.metadata?.name ?? ko.jsonData?.metadata?.name ?? node.id,
              namespace: ko.metadata?.namespace ?? ko.jsonData?.metadata?.namespace,
              kubeObject: resource.kubeObject,
              customResourceDefinition: resource.customResourceDefinition,
              providerName: resource.providerName,
              status: resource.status,
              color: categorized ? categoryColorMap.get(key) : undefined,
              categoryLabel: categorized ? categoryLabelOf(key) : undefined,
              childCount: childrenById.get(node.id)?.size ?? 0,
              collapsed: collapsedIds.has(node.id),
              onOpenDetails: resource.customResourceDefinition
                ? () => openDetails(resource)
                : undefined,
              onToggleCollapse: toggleCollapse,
            },
          },
        ];
      }),
    [
      nodes,
      resourcesById,
      selectedId,
      categoryMode,
      categoryColorMap,
      effectiveLabelKey,
      childrenById,
      targetHiddenIds,
      animatedVisibility,
      collapsedIds,
      openDetails,
      toggleCollapse,
    ]
  );
  const displayEdges = useMemo<Edge[]>(() => {
    const positionedIds = new Set(displayNodes.map(node => node.id));
    return (graph?.edges ?? [])
      .filter(edge => positionedIds.has(edge.source) && positionedIds.has(edge.target))
      .map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        // Keep arrowheads above the cards and their shadows.
        zIndex: 1,
        // Parent direction is implicit; dashed additional references need a label.
        label: edge.aux ? 'infers' : undefined,
        labelShowBg: true,
        labelBgPadding: [8, 4],
        labelBgBorderRadius: 6,
        // The referenced resource is the source, so arrows point against the layout direction.
        markerStart: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: edgeStroke,
        },
        // React Flow routes parent edges orthogonally and additional references as curves.
        type: edge.aux ? 'default' : 'smoothstep',
        style: edge.aux
          ? { stroke: edgeStroke, strokeWidth: 1.5, strokeDasharray: '6 4', opacity: 0.6 }
          : { stroke: edgeStroke, strokeWidth: 1.5 },
        hidden:
          animatedVisibility.hiddenIds.has(edge.source) ||
          animatedVisibility.hiddenIds.has(edge.target),
        className:
          animatedVisibility.transparentIds.has(edge.source) ||
          animatedVisibility.transparentIds.has(edge.target)
            ? 'crossplane-map-fading'
            : undefined,
        selectable: false,
        focusable: false,
        domAttributes: {
          'aria-hidden':
            targetHiddenIds.has(edge.source) || targetHiddenIds.has(edge.target) || undefined,
        },
      }));
  }, [graph?.edges, displayNodes, edgeStroke, targetHiddenIds, animatedVisibility]);

  if (graph?.error) {
    return (
      <Box p={3}>
        <ManagedGraphErrors {...graph} />
      </Box>
    );
  }

  if (!graph) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading Crossplane resources…</Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        // Headlamp adds navigation tabs above the route when the sidebar is collapsed.
        '.MuiContainer-root:has(> &)': { display: 'flex', flexDirection: 'column' },
        '& .react-flow__panel': { m: 2 },
        // React Flow labels capture pointer events even when their edge is inactive.
        '& .react-flow__edge-textwrapper': { pointerEvents: 'none' },
        '& .react-flow__node, & .react-flow__edge, & .react-flow__minimap-node': {
          transition: theme.transitions.create('opacity', { duration: fadeDuration }),
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        },
        '& .crossplane-map-fading': {
          opacity: 0,
          pointerEvents: 'none',
          '& *': { pointerEvents: 'none' },
        },
      }}
    >
      {!!graph.resourceErrors?.length && (
        <Box sx={{ mx: 3, mt: 2 }}>
          <ManagedGraphErrors {...graph} />
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <ReactFlow<Node<ResourceNodeData>>
          colorMode={theme.palette.mode}
          // Color the canvas itself; an opaque interaction pane would cover the dot grid.
          style={
            {
              '--xy-background-color': canvasBackground,
              '--xy-edge-label-background-color': theme.palette.background.paper,
              '--xy-edge-label-color': theme.palette.text.primary,
            } as React.CSSProperties
          }
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onPaneClick={() => setSelectedId(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          elevateNodesOnSelect={false}
          deleteKeyCode={null}
          minZoom={0.05}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
        >
          {/* Dots shrink with zoom; divider-colored 1px dots disappear in the fitted view. */}
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={2}
            color={theme.palette.grey[isDark ? 700 : 400]}
          />
          <Panel position="top-left" style={{ margin: 0, width: '100%', pointerEvents: 'none' }}>
            <Container maxWidth="xl">
              <Box sx={{ px: 2, pt: 3 }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    // Match Headlamp's resource-list title row, including its action-button height.
                    minHeight: 40,
                    width: 'fit-content',
                    mb: 1,
                    borderRadius: 1,
                    backgroundColor: canvasBackground,
                  }}
                >
                  <SectionHeader title="Crossplane Map" noPadding />
                </Box>
              </Box>
            </Container>
          </Panel>
          <Panel position="top-right">
            <GraphControls
              categoryMode={categoryMode}
              onCategoryModeChange={mode => {
                setCategoryMode(mode);
                setCategoryFilter(null);
              }}
              labelKey={effectiveLabelKey}
              labelKeys={labelKeys}
              onLabelKeyChange={key => {
                setLabelKey(key);
                setCategoryFilter(null);
              }}
              categoryColorMap={categoryColorMap}
              categoryOptions={categoryOptions}
              selectedCategories={categoryOptions.filter(
                value => selectedCategories === null || selectedCategories.includes(value)
              )}
              onCategorySelectionChange={values =>
                setCategoryFilter(
                  values === null ? null : { categoryMode, labelKey: effectiveLabelKey, values }
                )
              }
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
            />
          </Panel>
          {graph.nodes.length === 0 && !graph.resourceErrors?.length && (
            <Box
              role="status"
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
            >
              <Typography color="text.secondary">No Crossplane resources found.</Typography>
            </Box>
          )}
          {graph.nodes.length > 0 &&
            !hasFilterMatches &&
            graph.nodes.every(node => animatedVisibility.hiddenIds.has(node.id)) && (
              <Box
                role="status"
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'none',
                }}
              >
                <Typography color="text.secondary">
                  No resources match the selected filters.
                </Typography>
              </Box>
            )}
          <Paper
            component={Controls}
            variant="elevation"
            elevation={PANEL_ELEVATION}
            showFitView={false}
            showInteractive={false}
            sx={{
              ...PANEL_SX,
              '& .react-flow__controls-button': {
                backgroundColor: 'transparent',
                color: 'text.primary',
                borderColor: 'divider',
                '&:hover': { backgroundColor: 'action.hover' },
                '&:focus-visible': {
                  outline: `2px solid ${theme.palette.primary.main}`,
                  outlineOffset: -2,
                },
              },
            }}
          />
          <Paper
            component={MiniMap}
            variant="elevation"
            elevation={PANEL_ELEVATION}
            nodeClassName={(node: Node) => node.className ?? ''}
            nodeColor={theme.palette.action.disabled}
            maskColor={theme.palette.action.hover}
            sx={PANEL_SX}
          />
        </ReactFlow>
      </Box>
    </Box>
  );
}

function hasSameLayoutInput(current: GraphLayoutInput | null, next: GraphLayoutInput | null) {
  if (current === next) return true;
  if (!current || !next) return false;
  if (current.nodes.length !== next.nodes.length || current.edges.length !== next.edges.length) {
    return false;
  }
  const nextNodes = new Map(next.nodes.map(node => [node.id, node]));
  const nextEdges = new Map(next.edges.map(edge => [edge.id, edge]));
  return (
    current.nodes.every(node => {
      const other = nextNodes.get(node.id);
      return other?.width === node.width && other?.height === node.height;
    }) &&
    current.edges.every(edge => {
      const other = nextEdges.get(edge.id);
      return (
        other?.source === edge.source &&
        other?.target === edge.target &&
        Boolean(other?.aux) === Boolean(edge.aux)
      );
    })
  );
}

export default function CrossplaneMap() {
  const cluster = K8s.useCluster();
  // Resource IDs are not cluster-qualified, so view state must reset with the cluster.
  return <CrossplaneMapView key={cluster} />;
}
