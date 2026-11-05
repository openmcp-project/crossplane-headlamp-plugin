import {
  Node,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStoreApi,
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
import { getGraphCollapseState } from './graphCollapse';
import type { groupGraph } from './groupGraph';
import { createLayoutInterpolator, planGroupTransition, TransitionGraph } from './groupTransition';
import { GraphLayout, GraphLayoutInput, layoutGraph } from './layoutGraph';
import {
  AGGREGATED_NODE_HEIGHT,
  NAMESPACE_LINE_HEIGHT,
  NODE_WIDTH,
  RESOURCE_NODE_LAYOUT_HEIGHT,
} from './styles';

type LayoutCommit = TransitionGraph & { revision: number; fitViewport: boolean };
type GraphDrawing = TransitionGraph & { hiddenIds: ReadonlySet<string> };
type GroupMotion = GraphDrawing & { isAnimating: boolean };
type GroupCameraAnchor = { screenX: number; screenY: number; zoom: number } & (
  | { type: 'group'; memberId: string }
  | { type: 'ungroup'; memberIds: ReadonlySet<string> }
);

export function useGraphLayout({
  graph,
  viewGraph,
  collapsedIds,
  reduceMotion,
  mapElementRef,
  deferLayout,
}: {
  graph: ManagedGraphData | null;
  viewGraph: ReturnType<typeof groupGraph> | null;
  collapsedIds: ReadonlySet<string>;
  reduceMotion: boolean;
  mapElementRef: RefObject<HTMLDivElement>;
  deferLayout: boolean;
}) {
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const [groupMotion, setGroupMotion] = useState<GroupMotion | null>(null);
  const groupMotionRef = useRef<GroupMotion | null>(null);
  const groupTransitionRef = useRef<{ source: GraphDrawing; anchorNodeId?: string } | null>(null);
  const groupCameraRef = useRef<GroupCameraAnchor | null>(null);
  const targetHiddenIdsRef = useRef<ReadonlySet<string>>(new Set());
  const drawingRef = useRef<GraphDrawing | null>(null);
  const groupingSourceRef = useRef<{ ids: Set<string>; edges: Map<string, GraphEdge> } | null>(
    null
  );
  const groupingSource = groupingSourceRef.current;
  const groupingSourceChanged = Boolean(
    groupingSource &&
      graph &&
      (graph.nodes.length !== groupingSource.ids.size ||
        graph.edges.length !== groupingSource.edges.size ||
        graph.nodes.some(node => !groupingSource.ids.has(node.id)) ||
        graph.edges.some(edge => {
          const previous = groupingSource.edges.get(edge.id);
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
  const pendingGroupFocusRef = useRef<{ memberIds: string[]; grouped: boolean } | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const nodesInitialized = useNodesInitialized();
  const { fitView, getViewport, setViewport, viewportInitialized } = useReactFlow();
  const flowStore = useStoreApi();
  const nextLayoutInput = useMemo<GraphLayoutInput | null>(
    () =>
      viewGraph
        ? {
            nodes: viewGraph.nodes.map(node => {
              if (node.type === 'aggregated')
                return { id: node.id, width: NODE_WIDTH, height: AGGREGATED_NODE_HEIGHT };
              const namespace =
                node.resource.kubeObject?.metadata?.namespace ??
                node.resource.kubeObject?.jsonData?.metadata?.namespace;
              return {
                id: node.id,
                width: NODE_WIDTH,
                height: RESOURCE_NODE_LAYOUT_HEIGHT + (namespace ? NAMESPACE_LINE_HEIGHT : 0),
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
      // React Flow 12.12 has no viewport API for cancelling its measurement-owned fit queue.
      const { fitViewResolver } = flowStore.getState();
      flowStore.setState({
        fitViewQueued: false,
        fitViewOptions: undefined,
        fitViewResolver: null,
      });
      fitViewResolver?.resolve(false);
      if (interrupt) void setViewport(getViewport(), { duration: 0 });
    },
    [flowStore, getViewport, setViewport]
  );
  const interruptViewport = useCallback(
    (interrupt = true) => {
      pendingGroupFocusRef.current = null;
      groupCameraRef.current = null;
      if (groupTransitionRef.current) pendingLayoutActionRef.current = null;
      if (!viewportWorkRef.current) return;
      pendingLayoutActionRef.current = null;
      cancelViewportWork(interrupt);
    },
    [cancelViewportWork]
  );

  const relayout = useCallback(() => {
    groupCameraRef.current = null;
    if (groupMotionRef.current) {
      groupTransitionRef.current = { source: drawingRef.current ?? groupMotionRef.current };
    }
    pendingGroupFocusRef.current = null;
    currentLayoutRevisionRef.current += 1;
    cancelViewportWork();
    pendingLayoutActionRef.current = 'relayout';
    setLayoutTriggerRevision(current => current + 1);
  }, [cancelViewportWork]);
  const onFocusCapture = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      pendingGroupFocusRef.current = null;
      // Cancel before the card's focus handler pans through setCenter.
      if (event.target.closest('.react-flow__node')) interruptViewport();
    },
    [interruptViewport]
  );
  const prepareGroupTransition = useCallback(
    (
      focus?: { memberIds: string[]; grouped: boolean },
      cameraAnchor?: { nodeId: string; grouped: boolean }
    ) => {
      // Keep actual card sizes across grouping; ELK reserves space for two name lines.
      const viewport = getViewport();
      const { zoom } = viewport;
      for (const [id, size] of measureNodeSizes(mapElementRef.current, zoom)) {
        nodeSizesRef.current.set(id, size);
      }
      const source = drawingRef.current;
      const anchor = source?.viewGraph.nodes.find(node => node.id === cameraAnchor?.nodeId);
      const anchorPosition = anchor && source?.positions.get(anchor.id);
      groupCameraRef.current = null;
      if (anchor && anchorPosition) {
        if (cameraAnchor?.grouped) {
          groupCameraRef.current = {
            type: 'group',
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
            groupCameraRef.current = {
              type: 'ungroup',
              memberIds: new Set(anchor.members.map(member => member.id)),
              screenX: viewport.x + (anchorPosition.x + size.width / 2) * zoom,
              screenY: viewport.y + (anchorPosition.y + size.height / 2) * zoom,
              zoom,
            };
          }
        }
      }
      groupTransitionRef.current = source
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
            anchorNodeId: cameraAnchor?.grouped ? cameraAnchor.nodeId : undefined,
          }
        : null;
      groupingSourceRef.current = graph
        ? {
            ids: new Set(graph.nodes.map(node => node.id)),
            edges: new Map(graph.edges.map(edge => [edge.id, edge])),
          }
        : null;
      currentLayoutRevisionRef.current += 1;
      cancelViewportWork();
      pendingGroupFocusRef.current = focus ?? null;
      pendingLayoutActionRef.current = null;
    },
    [cancelViewportWork, graph, getViewport, mapElementRef]
  );
  const [layoutInput, setLayoutInput] = useState(nextLayoutInput);
  if (groupingSourceChanged && !hasSameLayoutInput(layoutInput, nextLayoutInput)) {
    // Changes hidden inside an aggregate do not invalidate its ongoing movement.
    groupingSourceRef.current = null;
    groupTransitionRef.current = null;
    groupMotionRef.current = null;
    groupCameraRef.current = null;
  }
  // Order and live metadata do not invalidate coordinates or unfinished layout work.
  if (!hasSameLayoutInput(layoutInput, nextLayoutInput)) setLayoutInput(nextLayoutInput);
  const layoutPending = !!layoutCommit && !hasSameLayoutInput(layoutCommit.input, layoutInput);
  const activeMotion = groupingSourceRef.current ? groupMotion : null;
  useLayoutEffect(() => {
    const anchor = groupCameraRef.current;
    const drawing = activeMotion ?? (layoutPending ? null : layoutCommit);
    if (!anchor || !drawing) return;
    if (anchor.type === 'ungroup') {
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
    if (!activeMotion) groupCameraRef.current = null;
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
    (layoutPending && groupingSourceRef.current
      ? groupTransitionRef.current?.source.viewGraph ?? layoutCommit.viewGraph
      : viewGraph);
  const visibleNodes = useMemo<Node[]>(
    () =>
      motionInput
        ? motionInput.nodes.map(({ id }) => ({ id, position: { x: 0, y: 0 }, data: {} }))
        : staticNodes ?? [],
    [motionInput, staticNodes]
  );
  const collapseState = useMemo(
    () => getViewCollapseState(graph, displayGraph, collapsedIds),
    [graph, displayGraph, collapsedIds]
  );
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
          ...getDisplayedDrawing(drawing, displayGraph),
          hiddenIds: isAnimating ? activeMotion!.hiddenIds : collapseState.hiddenIds,
        }
      : null;
  const sourceIsEmpty = graph?.nodes.length === 0;
  useEffect(() => {
    if (!sourceIsEmpty) return;
    pendingGroupFocusRef.current = null;
    groupCameraRef.current = null;
    groupingSourceRef.current = null;
    groupTransitionRef.current = null;
    groupMotionRef.current = null;
    setGroupMotion(null);
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
    if (!layoutInput || deferLayout) return;
    const requestedViewGraph = viewGraphRef.current;
    if (!requestedViewGraph) return;
    let cancelled = false;
    let animationFrame: number | undefined;
    const groupingTransition = groupTransitionRef.current;
    if (!groupingTransition) {
      groupMotionRef.current = null;
      setGroupMotion(null);
    }
    setLayoutError(null);
    const forceRelayout = pendingLayoutActionRef.current === 'relayout';
    const fitViewport = pendingLayoutActionRef.current === 'fit';
    const commit = ({ positions, routes }: GraphLayout) => {
      if (cancelled || revision !== currentLayoutRevisionRef.current) return;
      groupingSourceRef.current = null;
      groupTransitionRef.current = null;
      groupMotionRef.current = null;
      setGroupMotion(null);
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
      if (!groupingTransition || !groupingSourceRef.current || reduceMotionRef.current) {
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
      const plan = planGroupTransition(
        groupingTransition.source,
        next,
        groupingTransition.anchorNodeId
      );
      const showFrame = (
        layout: GraphLayout,
        drawing: TransitionGraph,
        hiddenIds: ReadonlySet<string>
      ) => {
        const frame = { ...drawing, ...layout, hiddenIds, isAnimating: true };
        groupMotionRef.current = frame;
        setGroupMotion(frame);
      };
      const animate = (
        interpolate: ReturnType<typeof createLayoutInterpolator>,
        drawing: TransitionGraph,
        hiddenIds: ReadonlySet<string>,
        duration: number,
        complete: () => void
      ) => {
        let started: number | undefined;
        showFrame(interpolate(0), drawing, hiddenIds);
        const tick = (time: number) => {
          if (cancelled || revision !== currentLayoutRevisionRef.current) return;
          if (reduceMotionRef.current) {
            commit(target);
            return;
          }
          started ??= time;
          const progress = Math.min(1, (time - started) / duration);
          const eased = progress * progress * (3 - 2 * progress);
          showFrame(interpolate(eased), drawing, hiddenIds);
          if (progress < 1) animationFrame = requestAnimationFrame(tick);
          else complete();
        };
        animationFrame = requestAnimationFrame(tick);
      };
      const settle = () =>
        animate(
          createLayoutInterpolator(plan.nextStartLayout, target),
          next,
          targetHiddenIdsRef.current,
          500,
          () => commit(target)
        );
      if (plan.hasGather) {
        animate(
          createLayoutInterpolator(groupingTransition.source, plan.gathered, {
            preserveRoutePointCorrespondence: true,
          }),
          groupingTransition.source,
          groupingTransition.source.hiddenIds,
          350,
          settle
        );
      } else settle();
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
          pendingGroupFocusRef.current = null;
          groupCameraRef.current = null;
          pendingLayoutActionRef.current = null;
          // Keep the last rendered geometry, but end its interaction lock on failure.
          if (groupMotionRef.current) {
            const stopped = { ...groupMotionRef.current, isAnimating: false };
            groupMotionRef.current = stopped;
            setGroupMotion(stopped);
          }
          setLayoutError(error instanceof Error ? error : new Error(String(error)));
        });

    return () => {
      cancelled = true;
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      if (revision === currentLayoutRevisionRef.current) currentLayoutRevisionRef.current += 1;
      cancelViewportWork();
    };
  }, [layoutInput, layoutTriggerRevision, deferLayout, setNodes, cancelViewportWork]);

  useEffect(() => {
    if (
      !nodesInitialized ||
      !pendingGroupFocusRef.current ||
      layoutCommit?.revision !== currentLayoutRevisionRef.current ||
      viewportCompleteRevision !== layoutCommit.revision
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const pending = pendingGroupFocusRef.current;
      if (!pending) return;
      // A newer focus outside the graph takes precedence over the completed layout.
      if (
        document.activeElement !== document.body &&
        !document.activeElement?.closest('.react-flow__node')
      ) {
        pendingGroupFocusRef.current = null;
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
        pendingGroupFocusRef.current = null;
        return;
      }
      const element = Array.from(
        mapElementRef.current?.querySelectorAll<HTMLElement>('.react-flow__node') ?? []
      ).find(node => targets.has(node.dataset.id ?? '') && !node.hasAttribute('inert'));
      const action = pending.grouped ? 'Ungroup' : 'Group';
      const button =
        element?.querySelector<HTMLButtonElement>(`button[aria-label^="${action} "]`) ??
        element?.querySelector<HTMLButtonElement>('button');
      if (!button) return;
      pendingGroupFocusRef.current = null;
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
    // React Flow 12.12 queues fitting through node updates and measurement.
    viewportWorkRef.current = { revision: layoutCommit.revision };
    void fitView({ nodes: visibleNodes, padding: 0.2, duration }).then(complete);
  }, [layoutCommit, viewportInitialized, nodes, targetHiddenIds, reduceMotion, fitView]);

  return {
    nodes: visibleNodes,
    onNodesChange,
    displayGraph,
    collapseState,
    motionPositions: activeMotion?.positions,
    motionHiddenIds: isAnimating ? activeMotion?.hiddenIds : undefined,
    routes: drawing?.routes,
    isAnimating,
    layoutPending,
    layoutError,
    prepareGroupTransition,
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
  anchor: GroupCameraAnchor,
  nodeSizes: ReadonlyMap<string, { width: number; height: number }>
): XYPosition | undefined {
  if (anchor.type === 'group') {
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
  viewGraph: ReturnType<typeof groupGraph>
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
  viewGraph: ReturnType<typeof groupGraph> | null,
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
