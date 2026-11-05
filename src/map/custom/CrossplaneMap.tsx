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
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openManagedDetail } from '../../managed/ManagedDetail';
import { ManagedGraphErrors } from '../common/ManagedGraphErrors';
import type { GraphNode } from '../common/types';
import { useManagedGraph } from '../common/useManagedGraph';
import { AggregatedNode, AggregatedNodeData } from './AggregatedNode';
import {
  categoryFieldsFromKubeObject,
  CategoryKey,
  categoryKeyOf,
  categoryLabelOf,
  CategoryMode,
  collectLabelKeys,
  generateCategoryColorMap,
} from './graphCategories';
import { GraphControls, StatusFilter } from './GraphControls';
import { collectAllGroups, groupGraph, GroupingCandidate, ResourceGroup } from './groupGraph';
import { GroupPreview } from './GroupPreview';
import type { ResourceNodeData } from './ResourceNode';
import { ResourceNode } from './ResourceNode';
import { RoutedEdge } from './RoutedEdge';
import { EDGE_LABEL_BG_PADDING, PANEL_ELEVATION, PANEL_SX } from './styles';
import { useAnimatedGraphVisibility } from './useAnimatedGraphVisibility';
import { useGraphLayout } from './useGraphLayout';

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
  const { matchingNodes, matchingIds } = useMemo(() => {
    const sourceNodes = graph?.nodes ?? [];
    const matchingNodes = sourceNodes.filter(
      node =>
        !categoryExcludedIds.has(node.id) &&
        (statusFilter === null || statusFilter.includes(node.status))
    );
    const matchingIds = new Set(matchingNodes.map(node => node.id));
    return {
      matchingNodes,
      matchingIds,
    };
  }, [graph, categoryExcludedIds, statusFilter]);
  const hasActiveFilters =
    statusFilter !== null || (categoryMode !== 'none' && selectedCategories !== null);
  const [groups, setGroups] = useState<ResourceGroup[]>([]);
  const [regroupHistory, setRegroupHistory] = useState<ResourceGroup[]>([]);
  const viewGraph = useMemo(
    () =>
      graph ? groupGraph(graph.nodes, graph.edges, groups, matchingIds, regroupHistory) : null,
    [graph, groups, matchingIds, regroupHistory]
  );
  const hasGroups = !!viewGraph?.nodes.some(node => node.type === 'aggregated');
  const [hoveredGroupNodeId, setHoveredGroupNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const mapElementRef = useRef<HTMLDivElement>(null);
  const nodeTypes = useMemo(() => ({ resource: ResourceNode, aggregated: AggregatedNode }), []);
  const edgeTypes = useMemo(() => ({ routed: RoutedEdge }), []);
  // Selection follows the detail action; a background click clears it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const labelFilterInvalidated =
    categoryMode === 'label' &&
    categoryFilter?.categoryMode === 'label' &&
    categoryFilter.labelKey !== effectiveLabelKey;
  const {
    nodes: visibleNodes,
    onNodesChange,
    displayGraph,
    collapseState,
    motionPositions,
    motionHiddenIds,
    routes,
    isAnimating,
    layoutPending,
    layoutError,
    prepareGroupTransition,
    onFocusCapture,
    relayout: relayoutMatchingView,
    interruptViewport,
  } = useGraphLayout({
    graph,
    viewGraph,
    collapsedIds,
    reduceMotion,
    mapElementRef,
    deferLayout: labelFilterInvalidated,
  });
  const { childrenById, resourceChildrenById, hiddenIds: collapseHiddenIds } = collapseState;
  const animatedVisibility = useAnimatedGraphVisibility(
    collapseHiddenIds,
    reduceMotion,
    fadeDuration
  );
  const visibleHiddenIds = motionHiddenIds ?? animatedVisibility.hiddenIds;
  const visibleExcludedIds = motionHiddenIds ?? collapseHiddenIds;
  const visibleTransparentIds = isAnimating ? null : animatedVisibility.transparentIds;
  const changeGroups = useCallback(
    (
      nextGroups: ResourceGroup[],
      focus?: { memberIds: string[]; grouped: boolean },
      cameraAnchor?: { nodeId: string; grouped: boolean }
    ) => {
      if (hasSameGroups(groups, nextGroups)) return;
      prepareGroupTransition(focus, cameraAnchor);
      setHoveredGroupNodeId(null);
      setFocusedNodeId(null);
      setGroups(nextGroups);
    },
    [groups, prepareGroupTransition]
  );
  const group = useCallback(
    (candidate: GroupingCandidate, anchorNodeId: string) => {
      const memberIds = candidate.members.map(member => member.id);
      const members = new Set(memberIds);
      setRegroupHistory(current => current.filter(group => !group.some(id => members.has(id))));
      changeGroups(
        [
          ...groups
            .map(existing => existing.filter(id => !members.has(id)))
            .filter(group => group.length > 1),
          memberIds,
        ],
        focusedNodeId && candidate.viewNodeIds.includes(focusedNodeId)
          ? { memberIds, grouped: true }
          : undefined,
        { nodeId: anchorNodeId, grouped: true }
      );
    },
    [changeGroups, groups, focusedNodeId]
  );
  const ungroup = useCallback(
    (members: GraphNode[], anchorNodeId: string) => {
      const memberIds = new Set(members.map(member => member.id));
      setRegroupHistory(current => [
        ...current.filter(group => !group.some(id => memberIds.has(id))),
        [...memberIds],
      ]);
      changeGroups(
        groups
          .map(existing => existing.filter(id => !memberIds.has(id)))
          .filter(group => group.length > 1),
        focusedNodeId ? { memberIds: [...memberIds], grouped: false } : undefined,
        { nodeId: anchorNodeId, grouped: false }
      );
    },
    [changeGroups, groups, focusedNodeId]
  );
  const groupAll = () => {
    if (!graph) return;
    const next = collectAllGroups(graph.nodes, graph.edges, matchingIds, groups);
    const affected = new Set(next.flat());
    setRegroupHistory(current => current.filter(group => !group.some(id => affected.has(id))));
    changeGroups(next);
  };
  const ungroupAll = () => {
    const visibleGroups =
      viewGraph?.nodes.flatMap(node =>
        node.type === 'aggregated' ? [node.members.map(member => member.id)] : []
      ) ?? [];
    const affected = new Set(visibleGroups.flat());
    setRegroupHistory(current => [
      ...current.filter(group => !group.some(id => affected.has(id))),
      ...visibleGroups,
    ]);
    changeGroups(
      groups.map(group => group.filter(id => !affected.has(id))).filter(group => group.length > 1)
    );
  };

  const toggleCollapse = useCallback(
    (id: string) => {
      const node = displayGraph?.nodes.find(node => node.id === id);
      const memberIds =
        node?.type === 'aggregated'
          ? node.members
              .filter(member => resourceChildrenById.has(member.id))
              .map(member => member.id)
          : [id];
      setCollapsedIds(current => {
        const next = new Set(current);
        const expand = memberIds.every(memberId => current.has(memberId));
        for (const memberId of memberIds) {
          if (expand) next.delete(memberId);
          else next.add(memberId);
        }
        return next;
      });
    },
    [displayGraph, resourceChildrenById]
  );
  const resourcesById = useMemo(
    () => new Map((graph?.nodes ?? []).map(node => [node.id, node])),
    [graph]
  );
  const viewNodesById = useMemo(
    () => new Map((displayGraph?.nodes ?? []).map(node => [node.id, node])),
    [displayGraph]
  );
  const previewCandidate = layoutPending
    ? undefined
    : viewGraph?.candidates.get(hoveredGroupNodeId ?? '');
  const highlightedNodeIds = useMemo(
    () => new Set(previewCandidate?.viewNodeIds ?? []),
    [previewCandidate]
  );

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
    setGroups([]);
    setRegroupHistory([]);
    setHoveredGroupNodeId(null);
    setFocusedNodeId(null);
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

  // Current node data is independent of the last completed layout.
  const displayNodes = useMemo<Node<ResourceNodeData | AggregatedNodeData>[]>(
    () =>
      visibleNodes.flatMap<Node<ResourceNodeData | AggregatedNodeData>>(node => {
        const viewNode = viewNodesById.get(node.id);
        if (!viewNode) return [];
        const candidate = layoutPending ? undefined : viewGraph?.candidates.get(node.id);
        const grouping = {
          candidateMemberCount: candidate?.members.length,
          onGroup: candidate ? () => group(candidate, node.id) : undefined,
          onGroupMouseEnter: () => setHoveredGroupNodeId(node.id),
          onGroupMouseLeave: () =>
            setHoveredGroupNodeId(current => (current === node.id ? null : current)),
          groupHighlighted: highlightedNodeIds.has(node.id),
        };
        const presentation = {
          ...node,
          // The card's native buttons own focus and selection.
          selectable: false,
          focusable: false,
          ariaRole: 'group',
          hidden: visibleHiddenIds.has(node.id),
          className: visibleTransparentIds?.has(node.id) ? 'crossplane-map-fading' : undefined,
          domAttributes: {
            ...node.domAttributes,
            'aria-describedby': undefined,
            'aria-hidden': visibleExcludedIds.has(node.id) || undefined,
            // Inert also excludes the card's native buttons during their exit fade.
            inert: visibleExcludedIds.has(node.id) || isAnimating ? '' : undefined,
          },
          selected: node.id === selectedId,
        };
        if (viewNode.type === 'aggregated') {
          const members = viewNode.members.map(member => resourcesById.get(member.id) ?? member);
          const ko = members[0].kubeObject;
          const apiVersion: string = ko?.jsonData?.apiVersion ?? ko?.apiVersion ?? '';
          const collapseMembers = viewNode.members.filter(member =>
            resourceChildrenById.has(member.id)
          );
          return [
            {
              ...presentation,
              type: 'aggregated',
              data: {
                ...grouping,
                kind: viewNode.kind,
                apiGroup: apiVersion.includes('/') ? apiVersion.split('/')[0] : '',
                memberCount: viewNode.members.length,
                healthyMemberCount: members.filter(member => member.status === 'success').length,
                childNodeCount: childrenById.get(node.id)?.size ?? 0,
                collapsed:
                  collapseMembers.length > 0 &&
                  collapseMembers.every(member => collapsedIds.has(member.id)),
                onToggleCollapse: collapseMembers.length > 0 ? toggleCollapse : undefined,
                onUngroup: () => ungroup(viewNode.members, node.id),
              },
            },
          ];
        }
        const resource = resourcesById.get(viewNode.id) ?? viewNode.resource;
        const ko = resource.kubeObject ?? {};
        const key = categoryKeyOf(
          categoryFieldsFromKubeObject(ko),
          categoryMode,
          effectiveLabelKey
        );
        const categorized = categoryMode !== 'none';
        return [
          {
            ...presentation,
            type: 'resource',
            data: {
              ...grouping,
              kind: ko.kind ?? ko.jsonData?.kind ?? 'Resource',
              name: ko.metadata?.name ?? ko.jsonData?.metadata?.name ?? node.id,
              namespace: ko.metadata?.namespace ?? ko.jsonData?.metadata?.namespace,
              status: resource.status,
              color: categorized ? categoryColorMap.get(key) : undefined,
              categoryLabel: categorized ? categoryLabelOf(key) : undefined,
              childNodeCount: childrenById.get(node.id)?.size ?? 0,
              collapsed: collapsedIds.has(node.id),
              onOpenDetails: resource.customResourceDefinition
                ? () => openDetails(resource)
                : undefined,
              onToggleCollapse: resourceChildrenById.has(node.id) ? toggleCollapse : undefined,
            },
          },
        ];
      }),
    [
      visibleNodes,
      viewNodesById,
      resourcesById,
      viewGraph,
      group,
      highlightedNodeIds,
      layoutPending,
      selectedId,
      categoryMode,
      categoryColorMap,
      effectiveLabelKey,
      childrenById,
      resourceChildrenById,
      visibleExcludedIds,
      visibleHiddenIds,
      visibleTransparentIds,
      isAnimating,
      collapsedIds,
      openDetails,
      toggleCollapse,
      ungroup,
    ]
  );
  // Position updates must not rebuild every card's data and callbacks on each frame.
  const positionedNodes = useMemo(
    () =>
      motionPositions
        ? displayNodes.map(node => ({
            ...node,
            position: motionPositions.get(node.id) ?? node.position,
          }))
        : displayNodes,
    [displayNodes, motionPositions]
  );
  const displayEdges = useMemo<Edge[]>(() => {
    const positionedIds = new Set(displayNodes.map(node => node.id));
    return (displayGraph?.edges ?? [])
      .filter(edge => positionedIds.has(edge.source) && positionedIds.has(edge.target))
      .flatMap(edge => {
        const route = routes?.get(edge.id);
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
            labelBgPadding: EDGE_LABEL_BG_PADDING,
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
            hidden: visibleHiddenIds.has(edge.source) || visibleHiddenIds.has(edge.target),
            className:
              visibleTransparentIds?.has(edge.source) || visibleTransparentIds?.has(edge.target)
                ? 'crossplane-map-fading'
                : undefined,
            selectable: false,
            focusable: false,
            domAttributes: {
              'aria-hidden':
                visibleExcludedIds.has(edge.source) ||
                visibleExcludedIds.has(edge.target) ||
                undefined,
              inert:
                visibleExcludedIds.has(edge.source) || visibleExcludedIds.has(edge.target)
                  ? ''
                  : undefined,
            },
          },
        ];
      });
  }, [
    displayGraph?.edges,
    routes,
    displayNodes,
    edgeStroke,
    visibleExcludedIds,
    visibleHiddenIds,
    visibleTransparentIds,
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
      ref={mapElementRef}
      onFocusCapture={event => {
        onFocusCapture(event);
        const target = event.target as HTMLElement;
        const node = target.closest<HTMLElement>('.react-flow__node');
        if (!node) return;
        const keyboardFocus = target.matches(':focus-visible');
        if (keyboardFocus) setHoveredGroupNodeId(null);
        setFocusedNodeId(keyboardFocus ? node.dataset.id ?? null : null);
      }}
      onBlurCapture={event => {
        const next = event.relatedTarget as HTMLElement | null;
        if (next?.closest('.react-flow__node') === event.target.closest('.react-flow__node'))
          return;
        setFocusedNodeId(null);
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
          transition: isAnimating
            ? 'none'
            : theme.transitions.create('opacity', { duration: fadeDuration }),
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
        <ReactFlow<Node<ResourceNodeData | AggregatedNodeData>>
          colorMode={theme.palette.mode}
          // Color the canvas itself; an opaque interaction pane would cover the dot grid.
          style={
            {
              '--xy-background-color': canvasBackground,
              '--xy-edge-label-background-color': theme.palette.background.paper,
              '--xy-edge-label-color': theme.palette.text.primary,
            } as React.CSSProperties
          }
          nodes={positionedNodes}
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
          {!isAnimating && hoveredGroupNodeId && highlightedNodeIds.size > 1 && (
            <GroupPreview
              nodes={positionedNodes.filter(
                node => highlightedNodeIds.has(node.id) && !visibleExcludedIds.has(node.id)
              )}
              targetId={hoveredGroupNodeId}
              reduceMotion={reduceMotion}
            />
          )}
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
              hasGroups={hasGroups}
              canGroup={!!viewGraph?.candidates.size}
              onGroupAll={groupAll}
              onUngroupAll={ungroupAll}
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
              selectedCategories={selectedCategories}
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
          {graph.nodes.length > 0 && matchingNodes.length === 0 && (
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
                  <Button color="inherit" onClick={relayoutMatchingView}>
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
            nodeColor={(node: Node) =>
              highlightedNodeIds.has(node.id)
                ? theme.palette.primary.main
                : theme.palette.action.disabled
            }
            maskColor={theme.palette.action.hover}
            sx={PANEL_SX}
          />
        </ReactFlow>
      </Box>
    </Box>
  );
}

function hasSameGroups(current: ResourceGroup[], next: ResourceGroup[]) {
  if (current.length !== next.length) return false;
  const keys = new Set(current.map(members => JSON.stringify([...members].sort())));
  return next.every(members => keys.has(JSON.stringify([...members].sort())));
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
