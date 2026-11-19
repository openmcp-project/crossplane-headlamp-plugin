import {
  Node,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useReactFlowStoreApi,
  XYPosition,
} from '@xyflow/react';
import {
  FocusEvent,
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { GraphEdge, ManagedGraphData } from '../common/types';
import type { aggregateGraph } from './aggregateGraph';
import {
  createLayoutInterpolator,
  planAggregateTransition,
  TransitionGraph,
} from './aggregateTransition';
import { getGraphCollapseState } from './graphCollapse';
import { GraphLayout, GraphLayoutInput, layoutGraph } from './layoutGraph';
import { AGGREGATED_NODE_HEIGHT, NODE_WIDTH, RESOURCE_NODE_LAYOUT_HEIGHT } from './styles';

type LayoutCommit = TransitionGraph & { revision: number; fitViewport: boolean };
type GraphDrawing = TransitionGraph & { hiddenIds: ReadonlySet<string> };
type AggregateMotion = GraphDrawing & {
  isAnimating: boolean;
  nodeOpacities?: ReadonlyMap<string, number>;
  crossfadeSource?: TransitionGraph;
};
export type AggregateTransitionOptions = {
  focus?: { memberIds: string[]; aggregated: boolean };
  cameraAnchor?: { nodeId: string; aggregated: boolean };
};
type AggregateCameraAnchor = { screenX: number; screenY: number; zoom: number } & (
  | { type: 'aggregate'; memberId: string }
  | { type: 'disaggregate'; memberIds: ReadonlySet<string> }
);

export function useGraphLayout({
  graph,
  viewGraph,
  collapsedIds,
  reduceMotion,
  mapElementRef,
}: {
  graph: ManagedGraphData | null;
  viewGraph: ReturnType<typeof aggregateGraph> | null;
  collapsedIds: ReadonlySet<string>;
  reduceMotion: boolean;
  mapElementRef: RefObject<HTMLDivElement>;
}) {
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const [aggregateMotion, setAggregateMotion] = useState<AggregateMotion | null>(null);
  const aggregateMotionRef = useRef<AggregateMotion | null>(null);
  const aggregateTransitionRef = useRef<{
    source: GraphDrawing;
    anchorNodeId?: string;
  } | null>(null);
  const aggregateCameraRef = useRef<AggregateCameraAnchor | null>(null);
  const targetHiddenIdsRef = useRef<ReadonlySet<string>>(new Set());
  const drawingRef = useRef<GraphDrawing | null>(null);
  const aggregationSourceRef = useRef<{ ids: Set<string>; edges: Map<string, GraphEdge> } | null>(
    null
  );
  const aggregationSource = aggregationSourceRef.current;
  const aggregationSourceChanged = Boolean(
    aggregationSource &&
      graph &&
      (graph.nodes.length !== aggregationSource.ids.size ||
        graph.edges.length !== aggregationSource.edges.size ||
        graph.nodes.some(node => !aggregationSource.ids.has(node.id)) ||
        graph.edges.some(edge => {
          const previous = aggregationSource.edges.get(edge.id);
          return (
            previous?.source !== edge.source ||
            previous?.target !== edge.target ||
            Boolean(previous?.aux) !== Boolean(edge.aux)
          );
        }))
  );
  const viewGraphRef = useRef(viewGraph);
  viewGraphRef.current = viewGraph;
  const nodeSizesRef = useRef(new Map<string, { width: number; height: number }>());
  const pendingAggregateFocusRef = useRef<{ memberIds: string[]; aggregated: boolean } | null>(
    null
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const nodesInitialized = useNodesInitialized();
  const { fitView, getViewport, setViewport, viewportInitialized } = useReactFlow();
  const { optionsStore } = useReactFlowStoreApi();
  const nextLayoutInput = useMemo<GraphLayoutInput | null>(
    () =>
      viewGraph
        ? {
            nodes: viewGraph.nodes.map(node => {
              if (node.type === 'aggregated')
                return { id: node.id, width: NODE_WIDTH, height: AGGREGATED_NODE_HEIGHT };
              return {
                id: node.id,
                width: NODE_WIDTH,
                height: RESOURCE_NODE_LAYOUT_HEIGHT,
              };
            }),
            edges: viewGraph.edges,
          }
        : null,
    [viewGraph]
  );
  const [layoutTriggerRevision, setLayoutTriggerRevision] = useState(0);
  const [layoutCommit, setLayoutCommit] = useState<LayoutCommit | null>(null);
  const layoutCommitRef = useRef<LayoutCommit | null>(null);
  const [layoutError, setLayoutError] = useState<Error | null>(null);
  const currentLayoutRevisionRef = useRef(0);
  const pendingLayoutActionRef = useRef<'fit' | 'relayout' | null>('fit');
  const viewportStartedRef = useRef<number | null>(null);
  const [viewportCompleteRevision, setViewportCompleteRevision] = useState<number | null>(null);
  const viewportWorkRef = useRef<{ revision: number } | null>(null);
  const cancelViewportWork = useCallback(
    (interrupt = true) => {
      const work = viewportWorkRef.current;
      if (!work) return;
      viewportWorkRef.current = null;
      // React Flow has no viewport API for cancelling its measurement-owned fit queue.
      const { fitViewResolver } = optionsStore.getState();
      optionsStore.setState({
        fitViewQueued: false,
        fitViewOptions: undefined,
        fitViewResolver: null,
      });
      fitViewResolver?.resolve(false);
      if (interrupt) void setViewport(getViewport(), { duration: 0 });
    },
    [optionsStore, getViewport, setViewport]
  );
  const interruptViewport = useCallback(
    (interrupt = true) => {
      pendingAggregateFocusRef.current = null;
      aggregateCameraRef.current = null;
      if (aggregateTransitionRef.current) pendingLayoutActionRef.current = null;
      if (!viewportWorkRef.current) return;
      pendingLayoutActionRef.current = null;
      cancelViewportWork(interrupt);
    },
    [cancelViewportWork]
  );

  const relayout = useCallback(() => {
    aggregateCameraRef.current = null;
    if (aggregateMotionRef.current) {
      aggregateTransitionRef.current = {
        source: drawingRef.current ?? aggregateMotionRef.current,
      };
    }
    pendingAggregateFocusRef.current = null;
    currentLayoutRevisionRef.current += 1;
    cancelViewportWork();
    pendingLayoutActionRef.current = 'relayout';
    setLayoutTriggerRevision(current => current + 1);
  }, [cancelViewportWork]);
  const onFocusCapture = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      pendingAggregateFocusRef.current = null;
      // Cancel before the card's focus handler pans through setCenter.
      if (event.target.closest('.react-flow__node')) interruptViewport();
    },
    [interruptViewport]
  );
  const prepareAggregateTransition = useCallback(
    ({ focus, cameraAnchor }: AggregateTransitionOptions = {}) => {
      // Keep actual card sizes across aggregation; ELK reserves space for two name lines.
      const viewport = getViewport();
      const { zoom } = viewport;
      for (const [id, size] of measureNodeSizes(mapElementRef.current, zoom)) {
        nodeSizesRef.current.set(id, size);
      }
      const source = drawingRef.current;
      const anchor = source?.viewGraph.nodes.find(node => node.id === cameraAnchor?.nodeId);
      const anchorPosition = anchor && source?.positions.get(anchor.id);
      aggregateCameraRef.current = null;
      if (anchor && anchorPosition) {
        if (cameraAnchor?.aggregated) {
          aggregateCameraRef.current = {
            type: 'aggregate',
            memberId: anchor.type === 'resource' ? anchor.id : anchor.members[0].id,
            screenX: viewport.x + anchorPosition.x * zoom,
            screenY: viewport.y + anchorPosition.y * zoom,
            zoom,
          };
        } else if (anchor.type === 'aggregated') {
          const size =
            nodeSizesRef.current.get(anchor.id) ??
            source?.input.nodes.find(node => node.id === anchor.id);
          if (size) {
            aggregateCameraRef.current = {
              type: 'disaggregate',
              memberIds: new Set(anchor.members.map(member => member.id)),
              screenX: viewport.x + (anchorPosition.x + size.width / 2) * zoom,
              screenY: viewport.y + (anchorPosition.y + size.height / 2) * zoom,
              zoom,
            };
          }
        }
      }
      aggregateTransitionRef.current = source
        ? {
            source: {
              ...source,
              input: {
                ...source.input,
                nodes: source.input.nodes.map(node => ({
                  ...node,
                  ...nodeSizesRef.current.get(node.id),
                })),
              },
            },
            anchorNodeId: cameraAnchor?.aggregated ? cameraAnchor.nodeId : undefined,
          }
        : null;
      aggregationSourceRef.current = graph
        ? {
            ids: new Set(graph.nodes.map(node => node.id)),
            edges: new Map(graph.edges.map(edge => [edge.id, edge])),
          }
        : null;
      currentLayoutRevisionRef.current += 1;
      cancelViewportWork();
      pendingAggregateFocusRef.current = focus ?? null;
      pendingLayoutActionRef.current = null;
    },
    [cancelViewportWork, graph, getViewport, mapElementRef]
  );
  const [layoutInput, setLayoutInput] = useState(nextLayoutInput);
  if (aggregationSourceChanged && !hasSameLayoutInput(layoutInput, nextLayoutInput)) {
    // Changes hidden inside an aggregate do not invalidate its ongoing movement.
    aggregationSourceRef.current = null;
    aggregateTransitionRef.current = null;
    aggregateMotionRef.current = null;
    aggregateCameraRef.current = null;
  }
  // Order and live metadata do not invalidate coordinates or unfinished layout work.
  if (!hasSameLayoutInput(layoutInput, nextLayoutInput)) setLayoutInput(nextLayoutInput);
  const layoutPending = !!layoutCommit && !hasSameLayoutInput(layoutCommit.input, layoutInput);
  const activeMotion = aggregationSourceRef.current ? aggregateMotion : null;
  useLayoutEffect(() => {
    const anchor = aggregateCameraRef.current;
    const drawing =
      activeMotion?.crossfadeSource ?? activeMotion ?? (layoutPending ? null : layoutCommit);
    if (!anchor || !drawing) return;
    if (anchor.type === 'disaggregate') {
      const measuredSizes = measureNodeSizes(mapElementRef.current, getViewport().zoom);
      for (const [id, size] of measuredSizes) nodeSizesRef.current.set(id, size);
      // React Flow mounts replacement cards after receiving the new node set.
      if (
        drawing.input.nodes.some(
          node =>
            anchor.memberIds.has(node.id) &&
            !targetHiddenIdsRef.current.has(node.id) &&
            !measuredSizes.has(node.id)
        )
      ) {
        return;
      }
    }
    const position = getCameraAnchorPosition(drawing, anchor, nodeSizesRef.current);
    if (position) {
      const viewport = {
        x: anchor.screenX - position.x * anchor.zoom,
        y: anchor.screenY - position.y * anchor.zoom,
        zoom: anchor.zoom,
      };
      const current = getViewport();
      if (current.x !== viewport.x || current.y !== viewport.y || current.zoom !== viewport.zoom) {
        // Move the camera with the rendered cards before the browser paints this frame.
        void setViewport(viewport, { duration: 0 });
      }
    }
    if (!activeMotion) aggregateCameraRef.current = null;
  }, [
    activeMotion,
    layoutPending,
    layoutCommit,
    nodesInitialized,
    nodes,
    getViewport,
    setViewport,
    mapElementRef,
  ]);
  const motionInput = activeMotion?.input;
  const staticNodes = motionInput ? null : nodes;
  const isAnimating = !!activeMotion?.isAnimating;
  // Keep the last complete graph until replacement nodes and routes are ready together.
  const displayGraph =
    activeMotion?.viewGraph ??
    (layoutPending && aggregationSourceRef.current
      ? aggregateTransitionRef.current?.source.viewGraph ?? layoutCommit.viewGraph
      : viewGraph);
  const visibleNodes = useMemo<Node[]>(
    () =>
      motionInput
        ? motionInput.nodes.map(({ id }) => ({ id, position: { x: 0, y: 0 }, data: {} }))
        : staticNodes ?? [],
    [motionInput, staticNodes]
  );
  const incomingViewGraph = activeMotion?.nodeOpacities ? viewGraph : undefined;
  const collapseState = useMemo(() => {
    const state = getViewCollapseState(graph, displayGraph, collapsedIds);
    if (incomingViewGraph) {
      const next = getViewCollapseState(graph, incomingViewGraph, collapsedIds);
      for (const [id, children] of next.childrenById) {
        if (!state.childrenById.has(id)) state.childrenById.set(id, children);
      }
    }
    return state;
  }, [graph, displayGraph, collapsedIds, incomingViewGraph]);
  const targetHiddenIds = useMemo(
    () =>
      displayGraph === viewGraph
        ? collapseState.hiddenIds
        : getViewCollapseState(graph, viewGraph, collapsedIds).hiddenIds,
    [graph, viewGraph, displayGraph, collapsedIds, collapseState]
  );
  targetHiddenIdsRef.current = targetHiddenIds;
  const drawing = activeMotion ?? layoutCommit;
  drawingRef.current =
    drawing && displayGraph
      ? {
          // Incoming cards join the logical graph only once the movement completes.
          ...(activeMotion?.crossfadeSource ?? getDisplayedDrawing(drawing, displayGraph)),
          hiddenIds: isAnimating ? activeMotion!.hiddenIds : collapseState.hiddenIds,
        }
      : null;
  const sourceIsEmpty = graph?.nodes.length === 0;
  useEffect(() => {
    if (!sourceIsEmpty) return;
    pendingAggregateFocusRef.current = null;
    aggregateCameraRef.current = null;
    aggregationSourceRef.current = null;
    aggregateTransitionRef.current = null;
    aggregateMotionRef.current = null;
    setAggregateMotion(null);
    nodeSizesRef.current.clear();
  }, [sourceIsEmpty]);

  useEffect(() => {
    if (!layoutCommitRef.current) pendingLayoutActionRef.current = 'fit';
    return () => {
      pendingLayoutActionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const revision = ++currentLayoutRevisionRef.current;
    if (!layoutInput) return;
    const requestedViewGraph = viewGraphRef.current;
    if (!requestedViewGraph) return;
    let cancelled = false;
    let animationFrame: number | undefined;
    const aggregationTransition = aggregateTransitionRef.current;
    if (!aggregationTransition) {
      aggregateMotionRef.current = null;
      setAggregateMotion(null);
    }
    setLayoutError(null);
    const forceRelayout = pendingLayoutActionRef.current === 'relayout';
    const fitViewport = pendingLayoutActionRef.current === 'fit';
    const commit = ({ positions, routes }: GraphLayout) => {
      if (cancelled || revision !== currentLayoutRevisionRef.current) return;
      aggregationSourceRef.current = null;
      aggregateTransitionRef.current = null;
      aggregateMotionRef.current = null;
      setAggregateMotion(null);
      // An empty transition is complete even before the viewport initializes.
      if (positions.size === 0) pendingLayoutActionRef.current = null;
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
        fitViewport: positions.size > 0 && fitViewport,
        viewGraph: requestedViewGraph,
      };
      layoutCommitRef.current = result;
      setLayoutCommit(result);
    };
    const transition = (target: GraphLayout) => {
      if (cancelled || revision !== currentLayoutRevisionRef.current) return;
      if (!aggregationTransition || !aggregationSourceRef.current || reduceMotionRef.current) {
        commit(target);
        return;
      }
      const next = {
        ...target,
        input: {
          ...layoutInput,
          nodes: layoutInput.nodes.map(node => ({ ...node, ...nodeSizesRef.current.get(node.id) })),
        },
        viewGraph: requestedViewGraph,
      };
      const plan = planAggregateTransition(
        aggregationTransition.source,
        next,
        aggregationTransition.anchorNodeId
      );
      const interpolate = createLayoutInterpolator(plan.start, plan.target);
      const outgoingNodes =
        plan.replacement === 'crossfade'
          ? plan.start.viewGraph.nodes.filter(node => !next.positions.has(node.id))
          : [];
      const outgoingIds = new Set(outgoingNodes.map(node => node.id));
      const incomingSources = plan.replacement === 'crossfade' ? plan.incomingSources : [];
      const incomingNodes = incomingSources.map(({ node }) => node);
      const incomingIds = new Set(incomingNodes.map(node => node.id));
      const previousSizes = new Map(plan.start.input.nodes.map(node => [node.id, node]));
      const nextSizes = new Map(next.input.nodes.map(node => [node.id, node]));
      const crossfadeDrawing = outgoingNodes.length
        ? {
            ...plan.start,
            input: {
              ...plan.start.input,
              nodes: [
                ...plan.start.input.nodes,
                ...next.input.nodes.filter(node => incomingIds.has(node.id)),
              ],
            },
            viewGraph: {
              ...plan.start.viewGraph,
              nodes: [...plan.start.viewGraph.nodes, ...incomingNodes],
            },
          }
        : null;
      const hiddenIds =
        plan.replacement === 'crossfade'
          ? aggregationTransition.source.hiddenIds
          : targetHiddenIdsRef.current;
      const showFrame = (layout: GraphLayout) => {
        const frame = { ...plan.start, ...layout, hiddenIds, isAnimating: true };
        aggregateMotionRef.current = frame;
        setAggregateMotion(frame);
      };
      const showCrossfade = (layout: GraphLayout, progress: number) => {
        const positions = new Map(layout.positions);
        for (const { node, sourceIds } of incomingSources) {
          if (!sourceIds.length) {
            positions.set(node.id, next.positions.get(node.id)!);
            continue;
          }
          const anchor = aggregationTransition.anchorNodeId;
          if (anchor && sourceIds.includes(anchor)) {
            positions.set(node.id, layout.positions.get(anchor)!);
            continue;
          }
          const centers = sourceIds.map(id => {
            const position = layout.positions.get(id)!;
            const size = previousSizes.get(id)!;
            return { x: position.x + size.width / 2, y: position.y + size.height / 2 };
          });
          const size = nextSizes.get(node.id)!;
          positions.set(node.id, {
            x: centers.reduce((sum, center) => sum + center.x, 0) / centers.length - size.width / 2,
            y:
              centers.reduce((sum, center) => sum + center.y, 0) / centers.length - size.height / 2,
          });
        }
        const frame = {
          ...crossfadeDrawing!,
          ...layout,
          positions,
          hiddenIds: new Set([...hiddenIds, ...targetHiddenIdsRef.current]),
          isAnimating: true,
          crossfadeSource: { ...plan.start, ...layout },
          nodeOpacities: new Map([
            ...[...outgoingIds].map(id => [id, 1 - progress] as const),
            ...[...incomingIds].map(id => [id, progress] as const),
          ]),
        };
        aggregateMotionRef.current = frame;
        setAggregateMotion(frame);
      };
      const movementDuration = 500;
      const crossfadeDuration = 100;
      let started: number | undefined;
      showFrame(interpolate(0));
      const tick = (time: number) => {
        if (cancelled || revision !== currentLayoutRevisionRef.current) return;
        if (reduceMotionRef.current) {
          commit(target);
          return;
        }
        started ??= time;
        const elapsed = time - started;
        if (elapsed < movementDuration) {
          const progress = elapsed / movementDuration;
          const eased = progress * progress * (3 - 2 * progress);
          const layout = interpolate(eased);
          const fadeProgress =
            (elapsed - (movementDuration - crossfadeDuration)) / crossfadeDuration;
          if (crossfadeDrawing && fadeProgress >= 0) showCrossfade(layout, fadeProgress);
          else showFrame(layout);
        } else {
          commit(target);
          return;
        }
        animationFrame = requestAnimationFrame(tick);
      };
      animationFrame = requestAnimationFrame(tick);
    };
    if (layoutInput.nodes.length === 0) transition({ positions: new Map(), routes: new Map() });
    else if (
      !forceRelayout &&
      hasSameLayoutInput(layoutCommitRef.current?.input ?? null, layoutInput)
    )
      transition(layoutCommitRef.current!);
    else
      layoutGraph(layoutInput)
        .then(transition)
        .catch(error => {
          if (cancelled || revision !== currentLayoutRevisionRef.current) return;
          pendingAggregateFocusRef.current = null;
          aggregateCameraRef.current = null;
          pendingLayoutActionRef.current = null;
          // Keep the last rendered geometry, but end its interaction lock on failure.
          if (aggregateMotionRef.current) {
            const motion = aggregateMotionRef.current;
            const stopped = {
              ...(motion.crossfadeSource ?? motion),
              hiddenIds: motion.hiddenIds,
              isAnimating: false,
            };
            aggregateMotionRef.current = stopped;
            setAggregateMotion(stopped);
          }
          setLayoutError(error instanceof Error ? error : new Error(String(error)));
        });

    return () => {
      cancelled = true;
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      if (revision === currentLayoutRevisionRef.current) currentLayoutRevisionRef.current += 1;
      cancelViewportWork();
    };
  }, [layoutInput, layoutTriggerRevision, setNodes, cancelViewportWork]);

  useEffect(() => {
    if (
      !nodesInitialized ||
      !pendingAggregateFocusRef.current ||
      layoutCommit?.revision !== currentLayoutRevisionRef.current ||
      viewportCompleteRevision !== layoutCommit.revision
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const pending = pendingAggregateFocusRef.current;
      if (!pending) return;
      // A newer focus outside the graph takes precedence over the completed layout.
      if (
        document.activeElement !== document.body &&
        !document.activeElement?.closest('.react-flow__node')
      ) {
        pendingAggregateFocusRef.current = null;
        return;
      }
      const members = new Set(pending.memberIds);
      const targets = new Set(
        viewGraph?.nodes
          .filter(
            node =>
              !targetHiddenIds.has(node.id) &&
              (node.type === 'aggregated'
                ? node.members.some(member => members.has(member.id))
                : members.has(node.id))
          )
          .map(node => node.id)
      );
      if (!targets.size) {
        pendingAggregateFocusRef.current = null;
        return;
      }
      const element = Array.from(
        mapElementRef.current?.querySelectorAll<HTMLElement>('.react-flow__node') ?? []
      ).find(node => targets.has(node.dataset.id ?? '') && !node.hasAttribute('inert'));
      const action = pending.aggregated ? 'Disaggregate' : 'Aggregate';
      const button =
        element?.querySelector<HTMLButtonElement>(`button[aria-label^="${action} "]`) ??
        element?.querySelector<HTMLButtonElement>('button');
      if (!button) return;
      pendingAggregateFocusRef.current = null;
      button.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    layoutCommit,
    viewportCompleteRevision,
    viewGraph,
    targetHiddenIds,
    nodesInitialized,
    mapElementRef,
  ]);

  useEffect(() => {
    if (
      !layoutCommit ||
      !viewportInitialized ||
      layoutCommit.revision !== currentLayoutRevisionRef.current ||
      viewportStartedRef.current === layoutCommit.revision
    )
      return;
    viewportStartedRef.current = layoutCommit.revision;
    const complete = () => {
      if (viewportWorkRef.current?.revision === layoutCommit.revision)
        viewportWorkRef.current = null;
      if (layoutCommit.revision !== currentLayoutRevisionRef.current) return;
      // Live replacement layouts retain the action until its viewport work completes.
      pendingLayoutActionRef.current = null;
      setViewportCompleteRevision(layoutCommit.revision);
    };
    if (!layoutCommit.fitViewport) {
      complete();
      return;
    }
    const duration = reduceMotion ? 0 : 400;
    const visibleNodes = nodes.filter(node => !targetHiddenIds.has(node.id));
    if (visibleNodes.length === 0) {
      complete();
      return;
    }
    // React Flow queues fitting through node updates and measurement.
    viewportWorkRef.current = { revision: layoutCommit.revision };
    // Round the legacy 0.2 padding upward to preserve whole-pixel margins.
    void fitView({ nodes: visibleNodes, padding: '8.334%', duration }).then(complete);
  }, [layoutCommit, viewportInitialized, nodes, targetHiddenIds, reduceMotion, fitView]);

  return {
    nodes: visibleNodes,
    onNodesChange,
    displayGraph,
    collapseState,
    motionPositions: activeMotion?.positions,
    motionOpacities: activeMotion?.nodeOpacities,
    motionHiddenIds: isAnimating ? activeMotion?.hiddenIds : undefined,
    routes: drawing?.routes,
    isAnimating,
    layoutPending,
    layoutError,
    prepareAggregateTransition,
    onFocusCapture,
    relayout,
    interruptViewport,
  };
}

function measureNodeSizes(mapElement: HTMLDivElement | null, zoom: number) {
  const sizes = new Map<string, { width: number; height: number }>();
  mapElement?.querySelectorAll<HTMLElement>('.react-flow__node').forEach(node => {
    const { width, height } = node.getBoundingClientRect();
    if (node.dataset.id && width && height) {
      sizes.set(node.dataset.id, { width: width / zoom, height: height / zoom });
    }
  });
  return sizes;
}

function getCameraAnchorPosition(
  drawing: TransitionGraph,
  anchor: AggregateCameraAnchor,
  nodeSizes: ReadonlyMap<string, { width: number; height: number }>
): XYPosition | undefined {
  if (anchor.type === 'aggregate') {
    const representative = drawing.viewGraph.nodes.find(node =>
      node.type === 'resource'
        ? node.id === anchor.memberId
        : node.members.some(member => member.id === anchor.memberId)
    );
    return representative && drawing.positions.get(representative.id);
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of drawing.input.nodes) {
    if (!anchor.memberIds.has(node.id)) continue;
    const point = drawing.positions.get(node.id);
    if (!point) continue;
    const size = nodeSizes.get(node.id) ?? node;
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x + size.width);
    bottom = Math.max(bottom, point.y + size.height);
  }
  return left === Infinity ? undefined : { x: (left + right) / 2, y: (top + bottom) / 2 };
}

function getDisplayedDrawing(
  drawing: TransitionGraph,
  viewGraph: ReturnType<typeof aggregateGraph>
): TransitionGraph {
  if (drawing.viewGraph === viewGraph) return drawing;
  const nodes = viewGraph.nodes.filter(node => drawing.positions.has(node.id));
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = viewGraph.edges.filter(edge => {
    const route = drawing.routes.get(edge.id);
    return (
      nodeIds.has(edge.source) &&
      nodeIds.has(edge.target) &&
      route?.source === edge.source &&
      route?.target === edge.target &&
      Boolean(route?.aux) === Boolean(edge.aux)
    );
  });
  const edgeIds = new Set(edges.map(edge => edge.id));
  return {
    input: { nodes: drawing.input.nodes.filter(node => nodeIds.has(node.id)), edges },
    positions: new Map([...drawing.positions].filter(([id]) => nodeIds.has(id))),
    routes: new Map([...drawing.routes].filter(([id]) => edgeIds.has(id))),
    viewGraph: { ...viewGraph, nodes, edges },
  };
}

function getViewCollapseState(
  graph: ManagedGraphData | null,
  viewGraph: ReturnType<typeof aggregateGraph> | null,
  collapsedIds: ReadonlySet<string>
) {
  const visibleResources = new Set(
    viewGraph?.nodes.flatMap(node =>
      node.type === 'resource' ? [node.id] : node.members.map(member => member.id)
    )
  );
  // Explicit collapse crosses filtered intermediate parents, but starts at a displayed resource.
  const { childrenById: resourceChildrenById, hiddenIds } = getGraphCollapseState(
    graph?.nodes ?? [],
    graph?.edges ?? [],
    new Set([...collapsedIds].filter(id => visibleResources.has(id)))
  );
  return {
    resourceChildrenById,
    childrenById: getGraphCollapseState(viewGraph?.nodes ?? [], viewGraph?.edges ?? [], new Set())
      .childrenById,
    hiddenIds: new Set(
      viewGraph?.nodes
        .filter(node =>
          node.type === 'resource'
            ? hiddenIds.has(node.id)
            : node.members.every(member => hiddenIds.has(member.id))
        )
        .map(node => node.id)
    ),
  };
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
