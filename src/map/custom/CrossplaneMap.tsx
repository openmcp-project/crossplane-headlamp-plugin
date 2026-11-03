import '@xyflow/react/dist/style.css';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { SectionHeader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Typography,
  useMediaQuery,
} from '@mui/material';
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
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStoreApi,
  Viewport,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { GraphLayout, GraphLayoutInput, layoutGraph } from './layoutGraph';
import type { ResourceNodeData } from './ResourceNode';
import { ResourceNode } from './ResourceNode';
import { RoutedEdge } from './RoutedEdge';
import {
  NAMESPACE_LINE_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
  PANEL_ELEVATION,
  PANEL_SX,
} from './styles';
import { useAnimatedGraphVisibility } from './useAnimatedGraphVisibility';

type ViewportAction = { type: 'fit' } | { type: 'restore'; viewport: Viewport };
type LayoutResult = GraphLayout & {
  input: GraphLayoutInput;
};
type LayoutCommit = LayoutResult & {
  revision: number;
  showMatchesOnly: boolean;
  viewportAction: ViewportAction | null;
};

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
  const { fitView, getViewport, setViewport, viewportInitialized } = useReactFlow();
  const flowStore = useStoreApi();
  const nodeTypes = useMemo(() => ({ resource: ResourceNode }), []);
  const edgeTypes = useMemo(() => ({ routed: RoutedEdge }), []);
  const resourcesById = useMemo(
    () => new Map((graph?.nodes ?? []).map(resource => [resource.id, resource])),
    [graph?.nodes]
  );
  const fullLayoutInput = useMemo<GraphLayoutInput | null>(
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const [categoryFilter, setCategoryFilter] = useState<{
    categoryMode: CategoryMode;
    labelKey: string;
    values: CategoryKey[];
  } | null>(null);
  const [showMatchesOnly, setShowMatchesOnly] = useState(false);
  const [transitionRevision, setTransitionRevision] = useState(0);
  const [layoutCommit, setLayoutCommit] = useState<LayoutCommit | null>(null);
  const layoutCommitRef = useRef<LayoutCommit | null>(null);
  const [layoutError, setLayoutError] = useState<Error | null>(null);
  const fullLayoutRef = useRef<LayoutResult | null>(null);
  const contextViewportRef = useRef<{ input: GraphLayoutInput; viewport: Viewport } | null>(null);
  const requestRevisionRef = useRef(0);
  const pendingTransitionRef = useRef<'fit' | 'return' | 'relayout' | null>('fit');
  const viewportStartedRef = useRef<number | null>(null);
  const viewportWorkRef = useRef<{ revision: number; action: ViewportAction } | null>(null);
  const cancelViewportWork = useCallback(
    (interrupt = true) => {
      const work = viewportWorkRef.current;
      if (!work) return;
      viewportWorkRef.current = null;
      if (work.action.type === 'fit') {
        // React Flow 12.12 has no viewport API for cancelling its measurement-owned fit queue.
        const { fitViewResolver } = flowStore.getState();
        flowStore.setState({
          fitViewQueued: false,
          fitViewOptions: undefined,
          fitViewResolver: null,
        });
        fitViewResolver?.resolve(false);
      }
      if (interrupt) void setViewport(getViewport(), { duration: 0 });
    },
    [flowStore, getViewport, setViewport]
  );
  const interruptViewport = useCallback(
    (interrupt = true) => {
      if (!viewportWorkRef.current) return;
      pendingTransitionRef.current = null;
      cancelViewportWork(interrupt);
      if (!layoutCommitRef.current?.showMatchesOnly) contextViewportRef.current = null;
    },
    [cancelViewportWork]
  );

  const changeView = useCallback(
    (matchesOnly: boolean, relayout = false) => {
      if (matchesOnly === showMatchesOnly && !relayout) return;
      // Retain the original context baseline until a return has fully committed.
      if (
        matchesOnly &&
        !contextViewportRef.current &&
        layoutCommit &&
        !layoutCommit.showMatchesOnly
      ) {
        contextViewportRef.current = { input: layoutCommit.input, viewport: getViewport() };
      }
      requestRevisionRef.current += 1;
      cancelViewportWork();
      pendingTransitionRef.current = relayout ? 'relayout' : matchesOnly ? 'fit' : 'return';
      setShowMatchesOnly(matchesOnly);
      setTransitionRevision(current => current + 1);
    },
    [showMatchesOnly, layoutCommit, getViewport, cancelViewportWork]
  );
  const relayoutMatchingView = useCallback(() => {
    if (showMatchesOnly) changeView(true, true);
  }, [showMatchesOnly, changeView]);

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
  const categoryExcludedIds = useMemo(() => {
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
  const { matchingNodes, nonMatchingIds } = useMemo(() => {
    const sourceNodes = graph?.nodes ?? [];
    const matchingNodes = sourceNodes.filter(
      node =>
        !categoryExcludedIds.has(node.id) &&
        (statusFilter === null || statusFilter.includes(node.status))
    );
    const matchingIds = new Set(matchingNodes.map(node => node.id));
    return {
      matchingNodes,
      nonMatchingIds: new Set(
        sourceNodes.filter(node => !matchingIds.has(node.id)).map(node => node.id)
      ),
    };
  }, [graph, categoryExcludedIds, statusFilter]);
  const hasActiveFilters =
    statusFilter !== null || (categoryMode !== 'none' && selectedCategories !== null);
  const { childrenById, hiddenIds: collapseHiddenIds } = useMemo(
    () =>
      getGraphCollapseState(
        graph?.nodes ?? [],
        graph?.edges ?? [],
        new Set([...collapsedIds].filter(id => !nonMatchingIds.has(id)))
      ),
    [graph, collapsedIds, nonMatchingIds]
  );
  const dimmedIds = useMemo(
    () => new Set([...nonMatchingIds].filter(id => !collapseHiddenIds.has(id))),
    [nonMatchingIds, collapseHiddenIds]
  );
  const excludedIds = useMemo(
    () => new Set([...nonMatchingIds, ...collapseHiddenIds]),
    [nonMatchingIds, collapseHiddenIds]
  );
  const animatedVisibility = useAnimatedGraphVisibility(
    collapseHiddenIds,
    reduceMotion,
    fadeDuration
  );
  const nextLayoutInput = useMemo<GraphLayoutInput | null>(() => {
    if (!fullLayoutInput || !showMatchesOnly) return fullLayoutInput;
    return {
      nodes: fullLayoutInput.nodes.filter(node => !nonMatchingIds.has(node.id)),
      edges: fullLayoutInput.edges.filter(
        edge => !nonMatchingIds.has(edge.source) && !nonMatchingIds.has(edge.target)
      ),
    };
  }, [fullLayoutInput, showMatchesOnly, nonMatchingIds]);
  const [layoutInput, setLayoutInput] = useState(nextLayoutInput);
  // Order and live metadata do not invalidate coordinates or unfinished layout work.
  if (!hasSameLayoutInput(layoutInput, nextLayoutInput)) setLayoutInput(nextLayoutInput);

  const labelFilterInvalidated =
    categoryMode === 'label' &&
    categoryFilter?.categoryMode === 'label' &&
    categoryFilter.labelKey !== effectiveLabelKey;
  const matchingFilterInvalidated = showMatchesOnly && labelFilterInvalidated;
  useEffect(() => {
    if (!labelFilterInvalidated) return;
    setCategoryFilter(null);
    relayoutMatchingView();
  }, [labelFilterInvalidated, relayoutMatchingView]);

  const sourceIsEmpty = graph?.nodes.length === 0;
  useEffect(() => {
    if (!sourceIsEmpty) return;
    setSelectedId(null);
    setCollapsedIds(new Set());
    fullLayoutRef.current = null;
    contextViewportRef.current = null;
  }, [sourceIsEmpty]);

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
    if (!layoutCommitRef.current) pendingTransitionRef.current = 'fit';
    return () => {
      pendingTransitionRef.current = null;
      contextViewportRef.current = null;
    };
  }, []);

  useEffect(() => {
    const revision = ++requestRevisionRef.current;
    if (!layoutInput || matchingFilterInvalidated) return;
    let cancelled = false;
    setLayoutError(null);
    const relayout = pendingTransitionRef.current === 'relayout';
    const cachedFullLayout =
      !relayout &&
      !showMatchesOnly &&
      hasSameLayoutInput(fullLayoutRef.current?.input ?? null, layoutInput)
        ? fullLayoutRef.current
        : null;
    const baseline = contextViewportRef.current;
    const viewportAction: ViewportAction | null =
      pendingTransitionRef.current === 'return' &&
      cachedFullLayout &&
      baseline &&
      hasSameLayoutInput(baseline.input, layoutInput)
        ? { type: 'restore', viewport: baseline.viewport }
        : pendingTransitionRef.current
        ? { type: 'fit' }
        : null;
    const commit = ({ positions, routes }: GraphLayout) => {
      if (cancelled || revision !== requestRevisionRef.current) return;
      if (!showMatchesOnly) fullLayoutRef.current = { input: layoutInput, positions, routes };
      // An empty transition is complete even before the viewport initializes.
      if (positions.size === 0) pendingTransitionRef.current = null;
      setNodes(current => {
        const currentById = new Map(current.map(node => [node.id, node]));
        return [...positions].map(([id, position]) => ({
          ...currentById.get(id),
          id,
          position,
          data: {},
        }));
      });
      const result = {
        input: layoutInput,
        positions,
        routes,
        revision,
        showMatchesOnly,
        viewportAction: positions.size === 0 ? null : viewportAction,
      };
      layoutCommitRef.current = result;
      setLayoutCommit(result);
    };
    if (layoutInput.nodes.length === 0) commit({ positions: new Map(), routes: new Map() });
    else if (cachedFullLayout) commit(cachedFullLayout);
    else if (!relayout && hasSameLayoutInput(layoutCommitRef.current?.input ?? null, layoutInput))
      commit(layoutCommitRef.current!);
    else
      layoutGraph(layoutInput)
        .then(commit)
        .catch(error => {
          if (cancelled || revision !== requestRevisionRef.current) return;
          pendingTransitionRef.current = null;
          setLayoutError(error instanceof Error ? error : new Error(String(error)));
        });

    return () => {
      cancelled = true;
      if (revision === requestRevisionRef.current) requestRevisionRef.current += 1;
      cancelViewportWork();
    };
  }, [
    layoutInput,
    showMatchesOnly,
    transitionRevision,
    matchingFilterInvalidated,
    setNodes,
    cancelViewportWork,
  ]);

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
              : dimmedIds.has(node.id)
              ? 'crossplane-map-dimmed'
              : undefined,
            domAttributes: {
              ...node.domAttributes,
              'aria-describedby': undefined,
              'aria-hidden': excludedIds.has(node.id) || undefined,
              // Inert also excludes the card's native buttons during their exit fade.
              inert: excludedIds.has(node.id) ? '' : undefined,
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
      dimmedIds,
      excludedIds,
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
      .flatMap(edge => {
        const route = layoutCommit?.routes.get(edge.id);
        if (
          !route ||
          route.source !== edge.source ||
          route.target !== edge.target ||
          Boolean(route.aux) !== Boolean(edge.aux)
        )
          return [];
        return [
          {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.aux ? 'aux-source' : 'source',
            targetHandle: edge.aux ? 'aux-target' : 'target',
            data: route,
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
            type: 'routed',
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
                : dimmedIds.has(edge.source) || dimmedIds.has(edge.target)
                ? 'crossplane-map-dimmed'
                : undefined,
            selectable: false,
            focusable: false,
            domAttributes: {
              'aria-hidden':
                excludedIds.has(edge.source) || excludedIds.has(edge.target) || undefined,
              inert: excludedIds.has(edge.source) || excludedIds.has(edge.target) ? '' : undefined,
            },
          },
        ];
      });
  }, [
    graph?.edges,
    layoutCommit,
    displayNodes,
    edgeStroke,
    excludedIds,
    dimmedIds,
    animatedVisibility,
  ]);

  useEffect(() => {
    if (
      !layoutCommit ||
      !viewportInitialized ||
      layoutCommit.revision !== requestRevisionRef.current ||
      viewportStartedRef.current === layoutCommit.revision
    )
      return;
    viewportStartedRef.current = layoutCommit.revision;
    const action = layoutCommit.viewportAction;
    const complete = () => {
      if (viewportWorkRef.current?.revision === layoutCommit.revision)
        viewportWorkRef.current = null;
      if (layoutCommit.revision !== requestRevisionRef.current) return;
      // Live replacement layouts retain the action until its viewport work completes.
      pendingTransitionRef.current = null;
      if (!layoutCommit.showMatchesOnly) contextViewportRef.current = null;
    };
    if (!action) {
      complete();
      return;
    }
    const duration = reduceMotion ? 0 : 400;
    if (action.type === 'restore') {
      viewportWorkRef.current = { revision: layoutCommit.revision, action };
      void setViewport(action.viewport, { duration }).then(complete);
      return;
    }
    const visibleNodes = displayNodes.filter(
      node =>
        !collapseHiddenIds.has(node.id) &&
        (!layoutCommit.showMatchesOnly || !nonMatchingIds.has(node.id))
    );
    if (visibleNodes.length === 0) {
      complete();
      return;
    }
    // React Flow 12.12 queues fitting through node updates and measurement.
    viewportWorkRef.current = { revision: layoutCommit.revision, action };
    void fitView({ nodes: visibleNodes, padding: 0.2, duration }).then(complete);
  }, [
    layoutCommit,
    viewportInitialized,
    displayNodes,
    collapseHiddenIds,
    nonMatchingIds,
    reduceMotion,
    fitView,
    setViewport,
  ]);

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
      onFocusCapture={event => {
        if (!(event.target as HTMLElement).closest('.react-flow__node')) return;
        // Cancel before the card's focus handler pans through setCenter.
        interruptViewport();
      }}
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
        '& .crossplane-map-dimmed': {
          opacity: 0.25,
          pointerEvents: 'none',
          '& *': { pointerEvents: 'none' },
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
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onPaneClick={() => setSelectedId(null)}
          onMoveStart={event => {
            if (!event) return;
            // User pan/zoom can interrupt D3 without resolving the viewport promise.
            interruptViewport(false);
          }}
          nodesDraggable={false}
          nodesConnectable={false}
          elevateNodesOnSelect={false}
          deleteKeyCode={null}
          minZoom={0.05}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
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
                relayoutMatchingView();
                setCategoryMode(mode);
                setCategoryFilter(null);
              }}
              labelKey={effectiveLabelKey}
              labelKeys={labelKeys}
              onLabelKeyChange={key => {
                relayoutMatchingView();
                setLabelKey(key);
                setCategoryFilter(null);
              }}
              categoryColorMap={categoryColorMap}
              categoryOptions={categoryOptions}
              selectedCategories={categoryOptions.filter(
                value => selectedCategories === null || selectedCategories.includes(value)
              )}
              onCategorySelectionChange={values => {
                relayoutMatchingView();
                setCategoryFilter(
                  values === null ? null : { categoryMode, labelKey: effectiveLabelKey, values }
                );
              }}
              statusFilter={statusFilter}
              onStatusFilterChange={statuses => {
                relayoutMatchingView();
                setStatusFilter(statuses);
              }}
              hasActiveFilters={hasActiveFilters}
              matchingCount={matchingNodes.length}
              totalCount={graph.nodes.length}
              showMatchesOnly={showMatchesOnly}
              onShowMatchesOnlyChange={changeView}
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
          {showMatchesOnly && graph.nodes.length > 0 && matchingNodes.length === 0 && (
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
          {layoutError && (
            <Panel position="bottom-center">
              <Alert
                severity="error"
                action={
                  <Button color="inherit" onClick={() => changeView(showMatchesOnly, true)}>
                    Retry
                  </Button>
                }
              >
                Could not arrange the map. {layoutError.message}
              </Alert>
            </Panel>
          )}
          <Paper
            component={Controls}
            variant="elevation"
            elevation={PANEL_ELEVATION}
            showFitView={false}
            showInteractive={false}
            onZoomIn={() => interruptViewport(false)}
            onZoomOut={() => interruptViewport(false)}
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
  return (
    <ReactFlowProvider key={cluster}>
      <CrossplaneMapView />
    </ReactFlowProvider>
  );
}
