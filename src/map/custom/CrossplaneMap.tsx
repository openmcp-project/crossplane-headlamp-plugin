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
  aggregateGraph,
  AggregationCandidate,
  collectAllAggregates,
  ResourceAggregate,
} from './aggregateGraph';
import { AggregatePreview } from './AggregatePreview';
import {
  assignCategoryColors,
  CategoryFields,
  categoryFieldsFromKubeObject,
  CategoryKey,
  categoryKeyOf,
  collectLabelKeys,
} from './graphCategories';
import { GraphControls, StatusFilter } from './GraphControls';
import type { ResourceNodeData } from './ResourceNode';
import { ResourceNode } from './ResourceNode';
import { RoutedEdge } from './RoutedEdge';
import { EDGE_LABEL_BG_PADDING, PANEL_ELEVATION, PANEL_SX } from './styles';
import { useAnimatedGraphVisibility } from './useAnimatedGraphVisibility';
import { AggregateTransitionOptions, useGraphLayout } from './useGraphLayout';

type FixedFilterDimension = 'flux' | 'kind';
type FilterDimensionId = FixedFilterDimension | `label:${string}`;

function keyOfDimension(fields: CategoryFields, dimension: FilterDimensionId): CategoryKey {
  if (dimension === 'kind') return fields.kind;
  if (dimension === 'flux') {
    return categoryKeyOf(fields, dimension);
  }
  return categoryKeyOf(fields, 'label', dimension.slice('label:'.length));
}

function optionsForDimension(
  fields: CategoryFields[],
  dimension: FilterDimensionId
): CategoryKey[] {
  let hasNull = false;
  const keys = new Set<string>();
  for (const f of fields) {
    const key = keyOfDimension(f, dimension);
    if (key === null) hasNull = true;
    else if (key) keys.add(key);
  }
  const sorted: CategoryKey[] = [...keys].sort();
  if (hasNull) sorted.unshift(null);
  return sorted;
}

function hasSelectableDimensionValues(options: CategoryKey[]): boolean {
  return options.some(key => key !== null);
}

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
  const revealPadding = 16;
  const revealSlantPercent = 20;
  const graph = useManagedGraph();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const [fixedFilters, setFixedFilters] = useState<
    Partial<Record<FixedFilterDimension, CategoryKey[]>>
  >({});
  const [labelFilters, setLabelFilters] = useState<
    Array<{ key: string; values: CategoryKey[] | null }>
  >([]);

  const categoryFields = useMemo(
    () => (graph?.nodes ?? []).map(node => categoryFieldsFromKubeObject(node.kubeObject)),
    [graph]
  );
  const labelKeys = useMemo(() => collectLabelKeys(categoryFields), [categoryFields]);
  const fluxOptions = useMemo(() => optionsForDimension(categoryFields, 'flux'), [categoryFields]);
  const kindOptions = useMemo(() => optionsForDimension(categoryFields, 'kind'), [categoryFields]);
  const kindColorMap = useMemo(
    () => assignCategoryColors(kindOptions, theme.palette.mode),
    [kindOptions, theme.palette.mode]
  );
  const addableLabelKeys = useMemo(() => {
    const activeKeys = new Set(labelFilters.map(filter => filter.key));
    return labelKeys.filter(key => !activeKeys.has(key));
  }, [labelKeys, labelFilters]);
  const { matchingNodes, matchingIds } = useMemo(() => {
    const sourceNodes = graph?.nodes ?? [];
    const activeDimensions: Array<{
      dimension: FilterDimensionId;
      selected: Set<CategoryKey>;
    }> = [];
    for (const dimension of ['flux', 'kind'] as const) {
      const values = fixedFilters[dimension];
      if (values !== undefined) {
        activeDimensions.push({ dimension, selected: new Set(values) });
      }
    }
    for (const { key, values } of labelFilters) {
      if (values !== null) {
        activeDimensions.push({ dimension: `label:${key}`, selected: new Set(values) });
      }
    }
    const matchingNodes = sourceNodes.filter((node, index) => {
      if (statusFilter !== null && !statusFilter.includes(node.status)) return false;
      if (activeDimensions.length === 0) return true;
      const fields = categoryFields[index];
      return activeDimensions.every(({ dimension, selected }) =>
        selected.has(keyOfDimension(fields, dimension))
      );
    });
    const matchingIds = new Set(matchingNodes.map(node => node.id));
    return {
      matchingNodes,
      matchingIds,
    };
  }, [graph, categoryFields, fixedFilters, labelFilters, statusFilter]);
  const [aggregates, setAggregates] = useState<ResourceAggregate[]>([]);
  const [reaggregateHistory, setReaggregateHistory] = useState<ResourceAggregate[]>([]);
  const viewGraph = useMemo(
    () =>
      graph
        ? aggregateGraph(graph.nodes, graph.edges, aggregates, matchingIds, reaggregateHistory)
        : null,
    [graph, aggregates, matchingIds, reaggregateHistory]
  );
  const hasAggregates = !!viewGraph?.nodes.some(node => node.type === 'aggregated');
  const [hoveredAggregateNodeId, setHoveredAggregateNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const mapElementRef = useRef<HTMLDivElement>(null);
  const nodeTypes = useMemo(() => ({ resource: ResourceNode, aggregated: AggregatedNode }), []);
  const edgeTypes = useMemo(() => ({ routed: RoutedEdge }), []);
  // Selection follows the detail action; a background click clears it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const {
    nodes: visibleNodes,
    onNodesChange,
    displayGraph,
    collapseState,
    motionPositions,
    motionOpacities,
    motionHiddenIds,
    routes,
    isAnimating,
    layoutPending,
    layoutError,
    prepareAggregateTransition,
    onFocusCapture,
    relayout,
    interruptViewport,
  } = useGraphLayout({
    graph,
    viewGraph,
    collapsedIds,
    reduceMotion,
    mapElementRef,
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
  const changeAggregates = useCallback(
    (nextAggregates: ResourceAggregate[], options?: AggregateTransitionOptions) => {
      if (hasSameAggregates(aggregates, nextAggregates)) return;
      prepareAggregateTransition(options);
      setHoveredAggregateNodeId(null);
      setFocusedNodeId(null);
      setAggregates(nextAggregates);
    },
    [aggregates, prepareAggregateTransition]
  );
  const aggregate = useCallback(
    (candidate: AggregationCandidate, anchorNodeId: string) => {
      const memberIds = candidate.members.map(member => member.id);
      const members = new Set(memberIds);
      setReaggregateHistory(current =>
        current.filter(aggregate => !aggregate.some(id => members.has(id)))
      );
      changeAggregates(
        [
          ...aggregates
            .map(existing => existing.filter(id => !members.has(id)))
            .filter(aggregate => aggregate.length > 1),
          memberIds,
        ],
        {
          focus:
            focusedNodeId && candidate.viewNodeIds.includes(focusedNodeId)
              ? { memberIds, aggregated: true }
              : undefined,
          cameraAnchor: { nodeId: anchorNodeId, aggregated: true },
        }
      );
    },
    [changeAggregates, aggregates, focusedNodeId]
  );
  const disaggregate = useCallback(
    (members: GraphNode[], anchorNodeId: string) => {
      const memberIds = new Set(members.map(member => member.id));
      setReaggregateHistory(current => [
        ...current.filter(aggregate => !aggregate.some(id => memberIds.has(id))),
        [...memberIds],
      ]);
      changeAggregates(
        aggregates
          .map(existing => existing.filter(id => !memberIds.has(id)))
          .filter(aggregate => aggregate.length > 1),
        {
          focus: focusedNodeId ? { memberIds: [...memberIds], aggregated: false } : undefined,
          cameraAnchor: { nodeId: anchorNodeId, aggregated: false },
        }
      );
    },
    [changeAggregates, aggregates, focusedNodeId]
  );
  const aggregateAll = () => {
    if (!graph) return;
    const next = collectAllAggregates(graph.nodes, graph.edges, matchingIds, aggregates);
    const affected = new Set(next.flat());
    setReaggregateHistory(current =>
      current.filter(aggregate => !aggregate.some(id => affected.has(id)))
    );
    changeAggregates(next);
  };
  const disaggregateAll = () => {
    const visibleAggregates =
      viewGraph?.nodes.flatMap(node =>
        node.type === 'aggregated' ? [node.members.map(member => member.id)] : []
      ) ?? [];
    const affected = new Set(visibleAggregates.flat());
    setReaggregateHistory(current => [
      ...current.filter(aggregate => !aggregate.some(id => affected.has(id))),
      ...visibleAggregates,
    ]);
    changeAggregates(
      aggregates
        .map(aggregate => aggregate.filter(id => !affected.has(id)))
        .filter(aggregate => aggregate.length > 1)
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
    : viewGraph?.candidates.get(hoveredAggregateNodeId ?? '');
  const highlightedNodeIds = useMemo(
    () => new Set(previewCandidate?.viewNodeIds ?? []),
    [previewCandidate]
  );

  const updateFixedFilter = useCallback(
    (dimension: FixedFilterDimension, values: CategoryKey[] | null) => {
      relayout();
      setFixedFilters(current => {
        if (values === null) {
          const next = { ...current };
          delete next[dimension];
          return next;
        }
        return { ...current, [dimension]: values };
      });
    },
    [relayout]
  );

  const sourceIsEmpty = graph?.nodes.length === 0;
  useEffect(() => {
    if (!sourceIsEmpty) return;
    setSelectedId(null);
    setCollapsedIds(new Set());
    setAggregates([]);
    setReaggregateHistory([]);
    setHoveredAggregateNodeId(null);
    setFocusedNodeId(null);
    setFixedFilters({});
    setLabelFilters([]);
  }, [sourceIsEmpty]);

  const openDetails = useCallback((node: GraphNode) => {
    setSelectedId(node.id);

    const ko = node.kubeObject;
    const crd = node.customResourceDefinition;
    const item = ko?.jsonData ?? ko ?? {};
    const kind: string = item.kind ?? '';
    const name: string = item.metadata?.name ?? '';
    const namespace: string | undefined = item.metadata?.namespace;
    const [apiGroup = '', version] = (item.apiVersion ?? '').split('/');
    // customResourceDefinition is "plural.group"; plural is everything before the API group.
    const plural: string = crd && apiGroup ? crd.slice(0, crd.length - apiGroup.length - 1) : '';

    if (!name || !apiGroup || !plural) return;

    openManagedDetail({
      providerName: node.providerName,
      group: apiGroup,
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
        const aggregation = {
          candidateMemberCount: candidate?.members.length,
          onAggregate: candidate ? () => aggregate(candidate, node.id) : undefined,
          onAggregateMouseEnter: () => setHoveredAggregateNodeId(node.id),
          onAggregateMouseLeave: () =>
            setHoveredAggregateNodeId(current => (current === node.id ? null : current)),
          aggregateHighlighted: highlightedNodeIds.has(node.id),
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
                ...aggregation,
                kind: viewNode.kind,
                // Aggregates are kind-homogeneous, so the whole card shares the kind color.
                color: kindColorMap.get(viewNode.kind),
                apiGroup: apiVersion.includes('/') ? apiVersion.split('/')[0] : '',
                memberCount: viewNode.members.length,
                healthyMemberCount: members.filter(member => member.status === 'success').length,
                childNodeCount: childrenById.get(node.id)?.size ?? 0,
                collapsed:
                  collapseMembers.length > 0 &&
                  collapseMembers.every(member => collapsedIds.has(member.id)),
                onToggleCollapse: collapseMembers.length > 0 ? toggleCollapse : undefined,
                onDisaggregate: () => disaggregate(viewNode.members, node.id),
              },
            },
          ];
        }
        const resource = resourcesById.get(viewNode.id) ?? viewNode.resource;
        const ko = resource.kubeObject ?? {};
        const fields = categoryFieldsFromKubeObject(ko);
        return [
          {
            ...presentation,
            type: 'resource',
            data: {
              ...aggregation,
              kind: ko.kind ?? ko.jsonData?.kind ?? 'Resource',
              name: ko.metadata?.name ?? ko.jsonData?.metadata?.name ?? node.id,
              namespace: ko.metadata?.namespace ?? ko.jsonData?.metadata?.namespace,
              status: resource.status,
              color: kindColorMap.get(fields.kind),
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
      aggregate,
      highlightedNodeIds,
      layoutPending,
      selectedId,
      kindColorMap,
      childrenById,
      resourceChildrenById,
      visibleExcludedIds,
      visibleHiddenIds,
      visibleTransparentIds,
      isAnimating,
      collapsedIds,
      openDetails,
      toggleCollapse,
      disaggregate,
    ]
  );
  // Position updates must not rebuild every card's data and callbacks on each frame.
  const positionedNodes = useMemo(
    () =>
      motionPositions
        ? displayNodes.map(node => ({
            ...node,
            position: motionPositions.get(node.id) ?? node.position,
            style: motionOpacities?.has(node.id)
              ? { ...node.style, opacity: motionOpacities.get(node.id) }
              : node.style,
          }))
        : displayNodes,
    [displayNodes, motionPositions, motionOpacities]
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
        if (keyboardFocus) setHoveredAggregateNodeId(null);
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
          // Keep card shadows, aggregate stacks and arrowheads inside the reveal.
          clipPath: `polygon(-${revealPadding}px -${revealPadding}px, calc(100% + ${revealPadding}px) -${revealPadding}px, calc(100% + ${revealPadding}px) calc(100% + ${revealPadding}px), -${revealPadding}px calc(${
            100 + revealSlantPercent
          }% + ${revealPadding}px))`,
          transition: isAnimating
            ? 'none'
            : theme.transitions.create(['opacity', 'clip-path'], { duration: fadeDuration }),
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        },
        '& .crossplane-map-fading': {
          opacity: 0,
          clipPath: `polygon(-${revealPadding}px -${revealPadding}px, calc(100% + ${revealPadding}px) -${revealPadding}px, calc(100% + ${revealPadding}px) calc(-${revealSlantPercent}% - ${revealPadding}px), -${revealPadding}px -${revealPadding}px)`,
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
          {!isAnimating && hoveredAggregateNodeId && highlightedNodeIds.size > 1 && (
            <AggregatePreview
              nodes={positionedNodes.filter(
                node => highlightedNodeIds.has(node.id) && !visibleExcludedIds.has(node.id)
              )}
              targetId={hoveredAggregateNodeId}
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
                  <SectionHeader title="Crossplane Map (preview)" noPadding />
                </Box>
              </Box>
            </Container>
          </Panel>
          {/* Reserve the 150px MiniMap, its 16px gap, and the two outer margins. */}
          <Panel position="top-right" style={{ display: 'flex', maxHeight: 'calc(100% - 198px)' }}>
            <GraphControls
              hasAggregates={hasAggregates}
              canAggregate={!!viewGraph?.candidates.size}
              onAggregateAll={aggregateAll}
              onDisaggregateAll={disaggregateAll}
              fluxFilter={
                hasSelectableDimensionValues(fluxOptions) || fixedFilters.flux !== undefined
                  ? {
                      options: fluxOptions,
                      selected: fixedFilters.flux ?? null,
                      onChange: values => updateFixedFilter('flux', values),
                    }
                  : undefined
              }
              kindFilter={
                hasSelectableDimensionValues(kindOptions) || fixedFilters.kind !== undefined
                  ? {
                      options: kindOptions,
                      selected: fixedFilters.kind ?? null,
                      onChange: values => updateFixedFilter('kind', values),
                      colorMap: kindColorMap,
                    }
                  : undefined
              }
              labelFilters={labelFilters.map(({ key, values }) => ({
                key,
                options: optionsForDimension(categoryFields, `label:${key}`),
                selected: values,
                onChange: nextValues => {
                  relayout();
                  setLabelFilters(current =>
                    current.map(entry =>
                      entry.key === key ? { ...entry, values: nextValues } : entry
                    )
                  );
                },
                onRemove: () => {
                  if (values !== null) relayout();
                  setLabelFilters(current => current.filter(entry => entry.key !== key));
                },
              }))}
              addableLabelKeys={addableLabelKeys}
              onAddLabelFilter={key => {
                setLabelFilters(current =>
                  current.some(entry => entry.key === key)
                    ? current
                    : [...current, { key, values: null }]
                );
              }}
              statusFilter={statusFilter}
              onStatusFilterChange={statuses => {
                relayout();
                setStatusFilter(statuses);
              }}
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
                  <Button color="inherit" onClick={relayout}>
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

function hasSameAggregates(current: ResourceAggregate[], next: ResourceAggregate[]) {
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
