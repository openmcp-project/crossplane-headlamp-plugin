import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildManagedGraph } from '../common/buildManagedGraph';
import CrossplaneMap from './CrossplaneMap';
import { AGGREGATED_NODE_HEIGHT, NODE_WIDTH, RESOURCE_NODE_LAYOUT_HEIGHT } from './styles';

const mocks = vi.hoisted(() => ({
  source: { current: null as any },
  cluster: { current: 'cluster-a' },
  layout: vi.fn(),
  openDetails: vi.fn(),
  nodes: [] as any[],
  edges: [] as any[],
  onNodesChange: vi.fn(),
  onMoveStart: vi.fn(),
  flowStore: { getState: vi.fn(), setState: vi.fn() },
  flowState: {
    fitViewQueued: false,
    fitViewOptions: undefined as any,
    fitViewResolver: null as any,
  },
  fitView: vi.fn(),
  setViewport: vi.fn(),
  getViewport: vi.fn(),
  viewport: { x: 0, y: 0, zoom: 1 },
  reduceMotion: true,
  renderNodeCards: false,
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useCluster: () => mocks.cluster.current },
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({ SectionHeader: () => null }));
vi.mock('@mui/material', async () => ({
  ...(await vi.importActual<typeof import('@mui/material')>('@mui/material')),
  useMediaQuery: () => mocks.reduceMotion,
}));
vi.mock('../../managed/ManagedDetail', () => ({ openManagedDetail: mocks.openDetails }));
vi.mock('../common/useManagedGraph', () => ({
  useManagedGraph: () => mocks.source.current,
}));
vi.mock('./placeEdgeLabels', async () => ({
  ...(await vi.importActual<typeof import('./placeEdgeLabels')>('./placeEdgeLabels')),
  // These viewport/state fixtures deliberately overlap nodes and routes; geometry has its own tests.
  placeEdgeLabels: () => new Map(),
}));
vi.mock('elkjs/lib/elk.bundled.js', () => ({
  default: class {
    async layout(input: any) {
      const result = await mocks.layout(input);
      return {
        ...result,
        edges: (result.edges ?? input.edges).map((edge: any) => ({
          ...edge,
          sections: edge.sections ?? [
            {
              id: `${edge.id}:section`,
              startPoint: { x: 132, y: 156 },
              endPoint: { x: 132, y: 316 },
            },
          ],
        })),
      };
    }
  },
}));
vi.mock('@xyflow/react', async () => {
  const { useNodesState } = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');
  return {
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    Controls: ({ onZoomIn, onZoomOut }: any) => (
      <div>
        <button
          type="button"
          onClick={() => {
            mocks.viewport = { ...mocks.viewport, zoom: mocks.viewport.zoom * 1.2 };
            // React Flow toolbar zooms do not carry a native source event.
            mocks.onMoveStart(undefined);
            onZoomIn?.();
          }}
        >
          Zoom in
        </button>
        <button
          type="button"
          onClick={() => {
            mocks.viewport = { ...mocks.viewport, zoom: mocks.viewport.zoom / 1.2 };
            mocks.onMoveStart(undefined);
            onZoomOut?.();
          }}
        >
          Zoom out
        </button>
      </div>
    ),
    Handle: () => null,
    MarkerType: { ArrowClosed: 'arrowclosed' },
    MiniMap: () => null,
    Panel: ({ children }: any) => <div>{children}</div>,
    Position: { Top: 'top', Bottom: 'bottom' },
    ReactFlowProvider: ({ children }: any) => children,
    ViewportPortal: ({ children }: any) => children,
    ReactFlow: ({ nodes, edges, children, onNodesChange, onMoveStart, nodeTypes }: any) => {
      mocks.nodes = nodes;
      mocks.edges = edges;
      mocks.onNodesChange = onNodesChange;
      mocks.onMoveStart = onMoveStart;
      return (
        <div>
          <div data-testid="nodes">
            {nodes
              .filter((node: any) => !node.hidden)
              .map((node: any) => node.id)
              .join(',')}
          </div>
          <div data-testid="edges">{edges.map((edge: any) => edge.id).join(',')}</div>
          {nodes
            .filter((node: any) => !mocks.renderNodeCards || !node.hidden)
            .map((node: any) => {
              const NodeCard = nodeTypes[node.type];
              return (
                <div className="react-flow__node" data-id={node.id} key={node.id}>
                  {mocks.renderNodeCards ? (
                    <NodeCard id={node.id} data={node.data} selected={node.selected} />
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-label={
                          node.type === 'aggregated'
                            ? `Ungroup ${node.data.kind}`
                            : `Open ${node.data.name}`
                        }
                        onClick={
                          node.type === 'aggregated' ? node.data.onUngroup : node.data.onOpenDetails
                        }
                      >
                        {node.type === 'aggregated'
                          ? `Ungroup ${node.data.kind}`
                          : `Open ${node.data.name}`}
                      </button>
                      {node.data.onGroup && (
                        <button
                          type="button"
                          aria-label={`Group ${
                            node.type === 'aggregated' ? node.data.kind : node.data.name
                          }`}
                          onClick={node.data.onGroup}
                          onMouseEnter={node.data.onGroupMouseEnter}
                          onMouseLeave={node.data.onGroupMouseLeave}
                        >
                          Group {node.type === 'aggregated' ? node.data.kind : node.data.name}
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          {children}
        </div>
      );
    },
    useNodesState,
    useStoreApi: () => mocks.flowStore,
    useNodesInitialized: () => true,
    useReactFlow: () => ({
      fitView: mocks.fitView,
      setViewport: mocks.setViewport,
      getViewport: mocks.getViewport,
      getNodes: () => mocks.nodes,
      getInternalNode: () => undefined,
      viewportInitialized: true,
    }),
  };
});

beforeEach(() => {
  mocks.layout.mockReset().mockImplementation(async graph => graph);
  mocks.openDetails.mockReset();
  mocks.source.current = null;
  mocks.cluster.current = 'cluster-a';
  mocks.nodes = [];
  mocks.edges = [];
  mocks.viewport = { x: 0, y: 0, zoom: 1 };
  mocks.reduceMotion = true;
  mocks.renderNodeCards = false;
  mocks.fitView.mockReset().mockResolvedValue(true);
  mocks.setViewport.mockReset().mockResolvedValue(true);
  mocks.getViewport.mockReset().mockImplementation(() => ({ ...mocks.viewport }));
  mocks.flowState = { fitViewQueued: false, fitViewOptions: undefined, fitViewResolver: null };
  mocks.flowStore.getState.mockReset().mockImplementation(() => mocks.flowState);
  mocks.flowStore.setState
    .mockReset()
    .mockImplementation(update => Object.assign(mocks.flowState, update));
});
afterEach(cleanup);

describe('Crossplane map category filtering', () => {
  it.each([
    {
      name: 'a literal default label',
      mode: 'Common Label',
      value: 'default',
      key: 'team',
    },
    {
      name: 'a literal null label',
      mode: 'Common Label',
      value: 'null',
      key: 'team',
    },
    {
      name: 'an own constructor label',
      mode: 'Common Label',
      value: 'billing',
      key: 'constructor',
    },
    {
      name: 'a literal default Flux name',
      mode: 'Flux',
      value: 'default',
      key: 'kustomize.toolkit.fluxcd.io/name',
    },
  ])('filters $name separately from missing metadata', async ({ mode, key, value }) => {
    const metadata =
      mode === 'Flux' ? { annotations: { [key]: value } } : { labels: { [key]: value } };
    mocks.source.current = {
      nodes: ['named', 'missing'].map(id => ({
        id,
        status: 'success',
        kubeObject: {
          jsonData: {
            apiVersion: 'example.org/v1',
            kind: 'ServiceInstance',
            metadata: { name: id, ...(id === 'named' ? metadata : {}) },
          },
        },
      })),
      edges: [],
    };
    render(<CrossplaneMap />);
    await waitFor(() => expect(screen.getByTestId('nodes').textContent).toBe('named,missing'));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Categorize by' }));
    fireEvent.click(screen.getByRole('option', { name: mode }));
    const filter = screen.getByRole('combobox', { name: mode });

    fireEvent.mouseDown(filter);
    fireEvent.click(screen.getByRole('option', { name: 'All' }));
    fireEvent.click(screen.getByRole('option', { name: value }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('nodes').textContent).toBe('named'));
    expect(filter.textContent).toContain(value);

    fireEvent.mouseDown(filter);
    fireEvent.click(screen.getByRole('option', { name: value }));
    fireEvent.click(screen.getByRole('option', { name: 'Not set' }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('nodes').textContent).toBe('missing'));
    expect(filter.textContent).toContain('Not set');

    fireEvent.mouseDown(filter);
    fireEvent.click(screen.getByRole('option', { name: 'All' }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('nodes').textContent).toBe('named,missing'));
    expect(filter.textContent).toContain('All');
    expect(mocks.nodes.every(node => !node.className?.includes('dimmed'))).toBe(true);
  });
});

function loadedGraph() {
  return {
    nodes: ['parent', 'child'].map(id => ({
      id,
      status: 'success',
      customResourceDefinition: 'resources.example.org',
      kubeObject: { apiVersion: 'example.org/v1', kind: 'Resource', metadata: { name: id } },
    })),
    edges: [{ id: 'relationship', source: 'parent', target: 'child' }],
  };
}

describe('Crossplane map discovery and layout state', () => {
  it('identifies separate namespace failures for the same resource type', () => {
    mocks.source.current = {
      nodes: [],
      edges: [],
      resourceErrors: ['team-a', 'team-b'].map(namespace => ({
        crdName: 'serviceinstances.example.org',
        namespace,
        error: new Error('Forbidden'),
      })),
    };
    render(<CrossplaneMap />);
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'serviceinstances.example.org (namespace: team-a): Forbidden',
      'serviceinstances.example.org (namespace: team-b): Forbidden',
    ]);
  });

  it('keeps successful resources visible alongside per-CRD errors', async () => {
    mocks.source.current = {
      ...loadedGraph(),
      resourceErrors: [{ crdName: 'serviceinstances.example.org', error: new Error('Forbidden') }],
    };
    const { rerender } = render(<CrossplaneMap />);
    await waitFor(() => expect(screen.getByTestId('nodes').textContent).toBe('parent,child'));
    expect(screen.getByRole('alert').textContent).toContain('Crossplane data is incomplete');
    expect(screen.getByRole('alert').textContent).toContain(
      'serviceinstances.example.org: Forbidden'
    );
    await act(async () => {
      mocks.source.current = { ...loadedGraph(), resourceErrors: [] };
      rerender(<CrossplaneMap />);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('nodes').textContent).toBe('parent,child');
  });

  it('does not claim there are no resources when all resource types failed', () => {
    mocks.source.current = {
      nodes: [],
      edges: [],
      resourceErrors: [{ crdName: 'serviceinstances.example.org', error: new Error('Forbidden') }],
    };
    render(<CrossplaneMap />);
    expect(screen.getByRole('alert').textContent).toContain('Forbidden');
    expect(screen.queryByText('No Crossplane resources found.')).toBeNull();
  });

  it.each(['v1beta2', 'v2'])(
    'opens the selected resource using its API version %s and namespace',
    async version => {
      mocks.source.current = {
        nodes: [
          {
            id: 'opaque-resource-id',
            providerName: 'installed-provider',
            customResourceDefinition: 'serviceinstances.example.org',
            kubeObject: {
              jsonData: {
                apiVersion: `example.org/${version}`,
                kind: 'ServiceInstance',
                metadata: { name: 'instance', namespace: 'team-a' },
              },
            },
          },
        ],
        edges: [],
      };
      render(<CrossplaneMap />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open instance' }));
      expect(mocks.openDetails).toHaveBeenCalledWith({
        providerName: 'installed-provider',
        group: 'example.org',
        version,
        plural: 'serviceinstances',
        name: 'instance',
        namespace: 'team-a',
        title: 'ServiceInstance instance',
        hideTitleInHeader: true,
      });
    }
  );

  it('updates live resource data without relayout or losing node measurements', async () => {
    mocks.layout.mockImplementation(async graph => ({
      ...graph,
      children: graph.children.map((node: any) => ({ ...node, x: 120, y: 75 })),
    }));
    mocks.source.current = loadedGraph();
    const { rerender } = render(<CrossplaneMap />);
    await waitFor(() => expect(screen.getByTestId('nodes').textContent).toBe('parent,child'));
    act(() =>
      mocks.onNodesChange([
        { id: 'parent', type: 'dimensions', dimensions: { width: 300, height: 180 } },
      ])
    );

    mocks.source.current = {
      ...loadedGraph(),
      nodes: loadedGraph()
        .nodes.reverse()
        .map(node => ({
          ...node,
          status: 'error',
          providerName: 'new-provider',
          kubeObject: {
            ...node.kubeObject,
            metadata: { ...node.kubeObject.metadata, labels: { team: 'new-team' } },
          },
        })),
    };
    rerender(<CrossplaneMap />);

    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.nodes.find(node => node.id === 'parent')).toMatchObject({
      position: { x: 120, y: 75 },
      measured: { width: 300, height: 180 },
      data: { status: 'error', categoryLabel: 'example.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open parent' }));
    expect(mocks.openDetails).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'parent', providerName: 'new-provider' })
    );
  });

  it('keeps pending layout work valid across resource-only updates', async () => {
    let finishLayout!: (graph: any) => void;
    mocks.layout.mockImplementation(() => new Promise(resolve => (finishLayout = resolve)));
    mocks.source.current = loadedGraph();
    const { rerender } = render(<CrossplaneMap />);
    const pendingLayout = mocks.layout.mock.calls[0][0];
    mocks.source.current = {
      ...loadedGraph(),
      nodes: loadedGraph().nodes.map(node => ({ ...node, status: 'error' })),
    };
    rerender(<CrossplaneMap />);
    expect(mocks.layout).toHaveBeenCalledTimes(1);

    await act(async () => finishLayout(pendingLayout));
    expect(screen.getByTestId('nodes').textContent).toBe('parent,child');
    expect(mocks.nodes.every(node => node.data.status === 'error')).toBe(true);
  });

  it('removes missing resources immediately and waits for positions before adding nodes and edges', async () => {
    mocks.source.current = loadedGraph();
    const { rerender } = render(<CrossplaneMap />);
    await waitFor(() => expect(screen.getByTestId('nodes').textContent).toBe('parent,child'));
    let finishLayout!: (graph: any) => void;
    mocks.layout.mockImplementation(() => new Promise(resolve => (finishLayout = resolve)));
    const parent = loadedGraph().nodes[0];
    mocks.source.current = {
      nodes: [parent, { ...parent, id: 'new-child' }],
      edges: [{ id: 'new-edge', source: 'parent', target: 'new-child' }],
    };
    rerender(<CrossplaneMap />);
    expect(screen.getByTestId('nodes').textContent).toBe('parent');
    expect(screen.getByTestId('edges').textContent).toBe('');

    await act(async () => finishLayout(mocks.layout.mock.calls[1][0]));
    expect(screen.getByTestId('nodes').textContent).toBe('parent,new-child');
    expect(screen.getByTestId('edges').textContent).toBe('new-edge');
  });

  it.each(['namespace height', 'edge direction', 'edge priority'])(
    'recalculates positions when %s changes and preserves existing measurements',
    async change => {
      mocks.source.current = loadedGraph();
      const { rerender } = render(<CrossplaneMap />);
      await waitFor(() => expect(screen.getByTestId('nodes').textContent).toBe('parent,child'));
      act(() =>
        mocks.onNodesChange([
          { id: 'parent', type: 'dimensions', dimensions: { width: 300, height: 180 } },
        ])
      );
      const graph = loadedGraph();
      mocks.source.current = {
        nodes: graph.nodes.map(node => ({
          ...node,
          kubeObject: {
            ...node.kubeObject,
            metadata: {
              ...node.kubeObject.metadata,
              namespace: change === 'namespace height' ? 'team-a' : undefined,
            },
          },
        })),
        edges: graph.edges.map(edge => ({
          ...edge,
          source: change === 'edge direction' ? edge.target : edge.source,
          target: change === 'edge direction' ? edge.source : edge.target,
          aux: change === 'edge priority',
        })),
      };
      await act(async () => rerender(<CrossplaneMap />));
      expect(mocks.layout).toHaveBeenCalledTimes(2);
      expect(mocks.nodes.find(node => node.id === 'parent').measured).toEqual({
        width: 300,
        height: 180,
      });
    }
  );

  it('waits for a matching route when a relationship changes while layout is pending', async () => {
    mocks.source.current = loadedGraph();
    const { rerender } = render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.edges).toHaveLength(1));
    let finishLayout!: (graph: any) => void;
    mocks.layout.mockImplementation(() => new Promise(resolve => (finishLayout = resolve)));
    mocks.source.current = {
      ...loadedGraph(),
      edges: [{ id: 'relationship', source: 'child', target: 'parent', aux: true }],
    };
    rerender(<CrossplaneMap />);
    expect(mocks.edges).toHaveLength(0);
    await act(async () => finishLayout(mocks.layout.mock.calls[1][0]));
    expect(mocks.edges[0]).toMatchObject({
      source: 'child',
      target: 'parent',
      sourceHandle: 'aux-source',
      targetHandle: 'aux-target',
      data: { source: 'child', target: 'parent', aux: true },
    });
  });

  it('does not apply an older layout after a newer topology has finished', async () => {
    const pending: Array<{ input: any; finish: (graph: any) => void }> = [];
    mocks.layout.mockImplementation(
      input => new Promise(resolve => pending.push({ input, finish: resolve }))
    );
    mocks.source.current = loadedGraph();
    const { rerender } = render(<CrossplaneMap />);
    mocks.source.current = { nodes: [loadedGraph().nodes[0]], edges: [] };
    rerender(<CrossplaneMap />);

    await act(async () => pending[1].finish(pending[1].input));
    expect(screen.getByTestId('nodes').textContent).toBe('parent');
    await act(async () => pending[0].finish(pending[0].input));
    expect(screen.getByTestId('nodes').textContent).toBe('parent');
    expect(screen.getByTestId('edges').textContent).toBe('');
  });

  it('resets selection, collapse and geometry when the cluster changes', async () => {
    mocks.source.current = loadedGraph();
    const { rerender } = render(<CrossplaneMap />);
    await waitFor(() => expect(screen.getByTestId('nodes').textContent).toBe('parent,child'));
    act(() => {
      mocks.nodes[0].data.onOpenDetails();
      mocks.nodes[0].data.onToggleCollapse('parent');
    });
    expect(screen.getByTestId('nodes').textContent).toBe('parent');
    expect(mocks.nodes[0].selected).toBe(true);

    mocks.cluster.current = 'cluster-b';
    await act(async () => rerender(<CrossplaneMap />));
    expect(mocks.layout).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('nodes').textContent).toBe('parent,child');
    expect(mocks.nodes.every(node => !node.selected && !node.data.collapsed)).toBe(true);
  });

  it('clears a loaded graph after pending discovery succeeds with no resources', async () => {
    mocks.source.current = loadedGraph();
    const { rerender } = render(<CrossplaneMap />);
    await waitFor(() => expect(screen.getByTestId('nodes').textContent).toBe('parent,child'));
    expect(screen.getByTestId('edges').textContent).toBe('relationship');

    mocks.source.current = null;
    rerender(<CrossplaneMap />);
    expect(screen.getByText('Loading Crossplane resources…')).toBeTruthy();
    mocks.source.current = { nodes: [], edges: [] };
    rerender(<CrossplaneMap />);
    expect(screen.getByText('No Crossplane resources found.')).toBeTruthy();
    expect(screen.getByTestId('nodes').textContent).toBe('');
    expect(screen.getByTestId('edges').textContent).toBe('');
  });

  it('does not restore nodes from an obsolete layout after discovery becomes empty', async () => {
    let finishLayout: (graph: any) => void;
    mocks.layout.mockImplementation(() => new Promise(resolve => (finishLayout = resolve)));
    mocks.source.current = loadedGraph();
    const { rerender } = render(<CrossplaneMap />);
    const oldLayout = mocks.layout.mock.calls[0][0];
    mocks.source.current = null;
    rerender(<CrossplaneMap />);
    mocks.source.current = { nodes: [], edges: [] };
    rerender(<CrossplaneMap />);
    await act(async () => finishLayout(oldLayout));
    expect(screen.getByTestId('nodes').textContent).toBe('');
    expect(screen.getByTestId('edges').textContent).toBe('');
    expect(screen.getByText('No Crossplane resources found.')).toBeTruthy();
  });

  it('observes an error transition even when source node and edge arrays stay unchanged', () => {
    const empty = { nodes: [], edges: [] };
    mocks.source.current = empty;
    const { rerender } = render(<CrossplaneMap />);
    mocks.source.current = { ...empty, error: new Error('Discovery forbidden') };
    rerender(<CrossplaneMap />);
    expect(screen.getByRole('alert').textContent).toContain('Discovery forbidden');
    expect(screen.queryByText('No Crossplane resources found.')).toBeNull();
    mocks.source.current = empty;
    rerender(<CrossplaneMap />);
    expect(screen.getByText('No Crossplane resources found.')).toBeTruthy();
  });
});

function filteringGraph() {
  return {
    nodes: ['parent', 'child', 'grandchild', 'leaf'].map(id => ({
      id,
      status: id === 'child' ? 'error' : 'success',
      customResourceDefinition: 'resources.example.org',
      kubeObject: {
        apiVersion: 'example.org/v1',
        kind: 'Resource',
        metadata: { name: id, labels: { team: id === 'child' ? 'red' : 'blue' } },
      },
    })),
    edges: [
      { id: 'parent-child', source: 'parent', target: 'child' },
      { id: 'child-grandchild', source: 'child', target: 'grandchild' },
      { id: 'grandchild-leaf', source: 'grandchild', target: 'leaf' },
      { id: 'reference', source: 'parent', target: 'grandchild', aux: true },
    ],
  };
}

function positionedLayout(input: any, offset = 0) {
  return {
    ...input,
    children: input.children.map((node: any, index: number) => ({
      ...node,
      x: offset + index * 360,
      y: offset + index * 220,
    })),
    edges: input.edges.map((edge: any, index: number) => ({
      ...edge,
      sections: [
        {
          id: `${edge.id}:section`,
          startPoint: { x: offset + index * 20, y: offset + 156 },
          endPoint: { x: offset + index * 20, y: offset + 316 },
        },
      ],
    })),
  };
}

function selectOption(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(screen.getByRole('option', { name: option }));
  if (screen.queryByRole('listbox')) {
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  }
}

function selectStatus(status: 'Healthy' | 'Needs Attention' | 'All') {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Status' }));
  if (status !== 'All') {
    const other = screen.getByRole('option', {
      name: status === 'Healthy' ? 'Needs Attention' : 'Healthy',
    });
    if (other.getAttribute('aria-selected') === 'true') fireEvent.click(other);
  }
  const option = screen.getByRole('option', { name: status });
  if (option.getAttribute('aria-selected') !== 'true') fireEvent.click(option);
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
}

function selectTeam(team = 'blue') {
  selectOption('Categorize by', 'Common Label');
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Common Label' }));
  fireEvent.click(screen.getByRole('option', { name: 'All' }));
  fireEvent.click(screen.getByRole('option', { name: team }));
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
}

function positions() {
  return mocks.nodes.map(node => ({ id: node.id, position: { ...node.position } }));
}

function node(id: string) {
  return mocks.nodes.find(node => node.id === id);
}

function delayedLayouts() {
  const pending: Array<{
    input: any;
    finish: (offset?: number) => void;
    fail: () => void;
  }> = [];
  mocks.layout.mockImplementation(
    input =>
      new Promise((resolve, reject) =>
        pending.push({
          input,
          finish: (offset = 0) => resolve(positionedLayout(input, offset)),
          fail: () => reject(new Error('Layout unavailable')),
        })
      )
  );
  return pending;
}

async function renderFilteringGraph() {
  mocks.layout.mockImplementation(async input => positionedLayout(input));
  mocks.source.current = filteringGraph();
  const result = render(<CrossplaneMap />);
  await waitFor(() => expect(mocks.nodes).toHaveLength(4));
  await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
  mocks.fitView.mockClear();
  mocks.setViewport.mockClear();
  mocks.viewport = { x: 240, y: -60, zoom: 0.7 };
  return { ...result, viewport: { ...mocks.viewport } };
}

async function renderBlueFilter() {
  const result = await renderFilteringGraph();
  selectTeam();
  await waitFor(() => expect(mocks.nodes).toHaveLength(3));
  expect(mocks.fitView).not.toHaveBeenCalled();
  expect(mocks.setViewport).not.toHaveBeenCalled();
  expect(mocks.viewport).toEqual(result.viewport);
  return result;
}

describe('Crossplane map resource filtering', () => {
  it('shows Needs Attention for a ready resource that is not synced', async () => {
    mocks.renderNodeCards = true;
    const graph = buildManagedGraph(
      [
        {
          jsonData: {
            apiVersion: 'account.btp.sap.crossplane.io/v1alpha1',
            kind: 'ServiceInstance',
            metadata: { name: 'sample', uid: 'sample' },
            status: {
              conditions: [
                { type: 'Ready', status: 'True' },
                { type: 'Synced', status: 'False' },
              ],
            },
          },
        },
      ],
      []
    );
    mocks.source.current = { nodes: graph.nodes, edges: graph.parentEdges };
    render(<CrossplaneMap />);

    expect(await screen.findByText('Needs Attention')).toBeTruthy();
    expect(screen.queryByText('Healthy')).toBeNull();
    selectStatus('Healthy');
    await waitFor(() => expect(mocks.nodes).toHaveLength(0));
    selectStatus('Needs Attention');
    expect(await screen.findByTitle('Needs Attention')).toBeTruthy();
  });

  it('toggles statuses independently and updates resource membership for every selection', async () => {
    await renderFilteringGraph();
    const filter = screen.getByRole('combobox', { name: 'Status' });
    expect(filter.textContent).toBe('All');
    fireEvent.mouseDown(filter);
    const all = screen.getByRole('option', { name: 'All' });
    const healthy = screen.getByRole('option', { name: 'Healthy' });
    const needsAttention = screen.getByRole('option', { name: 'Needs Attention' });
    const checked = () =>
      [all, healthy, needsAttention].map(
        option => option.querySelector<HTMLInputElement>('input')?.checked
      );
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
    expect(checked()).toEqual([true, true, true]);

    fireEvent.click(healthy);
    await waitFor(() => expect(mocks.nodes.map(node => node.id)).toEqual(['child']));
    expect(filter.textContent).toBe('Needs Attention');
    expect(all.querySelector('input')?.getAttribute('data-indeterminate')).toBe('true');
    expect(screen.getByText('1 of 4 resources match filters')).toBeTruthy();

    fireEvent.click(needsAttention);
    await waitFor(() => expect(mocks.nodes).toHaveLength(0));
    expect(filter.textContent).toBe('None');
    expect(checked()).toEqual([false, false, false]);
    expect(all.querySelector('input')?.getAttribute('data-indeterminate')).toBe('false');
    expect(screen.getByText('0 of 4 resources match filters')).toBeTruthy();

    fireEvent.click(healthy);
    await waitFor(() =>
      expect(mocks.nodes.map(node => node.id)).toEqual(['parent', 'grandchild', 'leaf'])
    );
    expect(filter.textContent).toBe('Healthy');
    expect(screen.getByText('3 of 4 resources match filters')).toBeTruthy();

    fireEvent.click(needsAttention);
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    expect(filter.textContent).toBe('All');
    expect(checked()).toEqual([true, true, true]);
    expect(screen.queryByText(/resources match filters/)).toBeNull();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  });

  it('keeps status checkboxes presentational so clicks stay with their keyboard-navigable option', async () => {
    await renderFilteringGraph();
    const filter = screen.getByRole('combobox', { name: 'Status' });
    fireEvent.mouseDown(filter);
    const input = screen
      .getByRole('option', { name: 'Healthy' })
      .querySelector<HTMLInputElement>('input')!;
    expect(getComputedStyle(input.closest('.MuiCheckbox-root')!).pointerEvents).toBe('none');
    fireEvent.click(input);
    expect(filter.textContent).toBe('Needs Attention');
    await waitFor(() => expect(mocks.nodes.map(node => node.id)).toEqual(['child']));
  });

  it('keeps the camera unchanged when clearing and restoring all statuses', async () => {
    const { viewport } = await renderFilteringGraph();
    selectOption('Status', 'All');
    await waitFor(() => expect(mocks.nodes).toHaveLength(0));
    expect(screen.getByText('No resources match the selected filters.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toBe('None');
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
    expect(screen.queryByRole('checkbox', { name: 'Hide non-matching' })).toBeNull();

    selectOption('Status', 'All');
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
    expect(screen.queryByText('No resources match the selected filters.')).toBeNull();
  });

  it('hides only excluded resources and their incident edges while preserving matching descendants', async () => {
    await renderBlueFilter();
    expect(mocks.nodes.map(node => node.id)).toEqual(['parent', 'grandchild', 'leaf']);
    expect(mocks.edges.map(edge => edge.id)).toEqual(['grandchild-leaf', 'reference']);
    expect(node('grandchild').domAttributes['aria-hidden']).toBeUndefined();
    expect(node('grandchild').domAttributes.inert).toBeUndefined();
    expect(mocks.nodes.every(node => !node.className?.includes('dimmed'))).toBe(true);
    expect(mocks.edges.every(edge => !edge.className?.includes('dimmed'))).toBe(true);

    selectOption('Common Label', 'All');
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    expect(mocks.edges.map(edge => edge.id)).toEqual(filteringGraph().edges.map(edge => edge.id));
  });

  it('combines category and status filters and counts matches independently of collapse', async () => {
    await renderBlueFilter();
    act(() => node('parent').data.onToggleCollapse('parent'));
    expect(screen.getByTestId('nodes').textContent).toBe('parent');
    expect(screen.getByText('3 of 4 resources match filters')).toBeTruthy();
    mocks.fitView.mockClear();
    selectStatus('Needs Attention');
    await waitFor(() => expect(mocks.nodes).toHaveLength(0));
    expect(screen.getByText('0 of 4 resources match filters')).toBeTruthy();
    expect(screen.getByText('No resources match the selected filters.')).toBeTruthy();
    expect(mocks.fitView).not.toHaveBeenCalled();
  });

  it('uses singular wording when the source graph holds one resource', async () => {
    mocks.source.current = { nodes: [filteringGraph().nodes[0]], edges: [] };
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(1));
    selectStatus('Healthy');
    expect(screen.getByText('1 of 1 resource matches filters')).toBeTruthy();
    selectStatus('Needs Attention');
    await waitFor(() => expect(mocks.nodes).toHaveLength(0));
    expect(screen.getByText('0 of 1 resource matches filters')).toBeTruthy();
  });

  it.each(['category mode', 'category selection', 'status', 'label key'])(
    'lays out current matches without changing the camera after changing %s',
    async change => {
      const { rerender, viewport } = await renderBlueFilter();
      if (change === 'label key') {
        mocks.source.current = {
          ...mocks.source.current,
          nodes: mocks.source.current.nodes.map((node: any, index: number) => ({
            ...node,
            kubeObject: {
              ...node.kubeObject,
              metadata: {
                ...node.kubeObject.metadata,
                labels: {
                  ...node.kubeObject.metadata.labels,
                  ...(index === 0 ? { env: 'dev' } : {}),
                },
              },
            },
          })),
        };
        rerender(<CrossplaneMap />);
      }
      if (change === 'status') {
        mocks.source.current = {
          ...mocks.source.current,
          nodes: mocks.source.current.nodes.map((resource: any) => ({
            ...resource,
            status: resource.id === 'leaf' ? 'error' : resource.status,
          })),
        };
        rerender(<CrossplaneMap />);
      }
      mocks.fitView.mockClear();
      mocks.layout.mockImplementation(async input => positionedLayout(input, 100));
      if (change === 'category mode') selectOption('Categorize by', 'Flux');
      if (change === 'category selection') selectOption('Common Label', 'red');
      if (change === 'status') selectStatus('Needs Attention');
      if (change === 'label key') selectOption('Label', 'env');
      const expectedIds =
        change === 'status' ? ['leaf'] : ['parent', 'child', 'grandchild', 'leaf'];
      await waitFor(() => expect(mocks.nodes.map(resource => resource.id)).toEqual(expectedIds));
      expect(mocks.fitView).not.toHaveBeenCalled();
      expect(mocks.setViewport).not.toHaveBeenCalled();
      expect(mocks.viewport).toEqual(viewport);
      expect(
        mocks.layout.mock.calls.at(-1)[0].children.map((resource: any) => resource.id)
      ).toEqual(expectedIds);
      expect(node(expectedIds[0]).position).toEqual({ x: 100, y: 100 });
    }
  );

  it.each(['topology', 'dimensions', 'edge priority'])(
    'uses current source %s when excluded resources become visible again',
    async change => {
      const { rerender, viewport } = await renderBlueFilter();
      const graph = filteringGraph();
      mocks.source.current = {
        ...graph,
        nodes: graph.nodes.map(node => ({
          ...node,
          kubeObject: {
            ...node.kubeObject,
            metadata: {
              ...node.kubeObject.metadata,
              ...(change === 'dimensions' && node.id === 'child' ? { namespace: 'team-a' } : {}),
            },
          },
        })),
        edges: graph.edges.map(edge =>
          edge.id === 'parent-child'
            ? {
                ...edge,
                source: change === 'topology' ? 'grandchild' : edge.source,
                aux: change === 'edge priority',
              }
            : edge
        ),
      };
      rerender(<CrossplaneMap />);
      const layouts = mocks.layout.mock.calls.length;
      mocks.fitView.mockClear();
      selectOption('Common Label', 'All');
      await waitFor(() => expect(mocks.nodes).toHaveLength(4));
      expect(mocks.layout).toHaveBeenCalledTimes(layouts + 1);
      expect(mocks.fitView).not.toHaveBeenCalled();
      expect(mocks.setViewport).not.toHaveBeenCalled();
      expect(mocks.viewport).toEqual(viewport);
      if (change === 'dimensions') expect(node('child').data.namespace).toBe('team-a');
      else
        expect(mocks.edges.find(edge => edge.id === 'parent-child')).toMatchObject(
          change === 'topology' ? { source: 'grandchild' } : { sourceHandle: 'aux-source' }
        );
    }
  );

  it.each(['category', 'status'])(
    'updates live %s matches without moving the viewport',
    async filter => {
      const { rerender, viewport } = await renderFilteringGraph();
      if (filter === 'category') selectTeam();
      else selectStatus('Healthy');
      await waitFor(() => expect(mocks.nodes).toHaveLength(3));
      expect(mocks.fitView).not.toHaveBeenCalled();
      expect(mocks.setViewport).not.toHaveBeenCalled();
      expect(mocks.viewport).toEqual(viewport);
      mocks.source.current = {
        ...filteringGraph(),
        nodes: filteringGraph().nodes.map(node => ({
          ...node,
          status: filter === 'status' && node.id === 'parent' ? 'error' : node.status,
          kubeObject: {
            ...node.kubeObject,
            metadata: { ...node.kubeObject.metadata, labels: { team: 'blue' } },
          },
        })),
      };
      rerender(<CrossplaneMap />);
      await waitFor(() =>
        expect(mocks.nodes.map(node => node.id)).toEqual(
          filter === 'category' ? ['parent', 'child', 'grandchild', 'leaf'] : ['grandchild', 'leaf']
        )
      );
      expect(mocks.fitView).not.toHaveBeenCalled();
      expect(mocks.setViewport).not.toHaveBeenCalled();
      expect(mocks.viewport).toEqual(viewport);
    }
  );

  it('retains an explicit category filter when it becomes the only available category', async () => {
    const { rerender } = await renderBlueFilter();
    const graph = filteringGraph();
    const filter = screen.getByRole('combobox', { name: 'Common Label' });
    mocks.source.current = {
      ...graph,
      nodes: graph.nodes.filter(node => node.id !== 'child'),
      edges: graph.edges.filter(edge => edge.source !== 'child' && edge.target !== 'child'),
    };
    rerender(<CrossplaneMap />);
    await waitFor(() =>
      expect(screen.getByTestId('nodes').textContent).toBe('parent,grandchild,leaf')
    );
    expect(filter.textContent).toBe('blue');

    fireEvent.mouseDown(filter);
    const all = screen.getByRole('option', { name: 'All' });
    expect(all.getAttribute('aria-selected')).toBe('false');
    expect(all.querySelector<HTMLInputElement>('input')?.checked).toBe(false);
    expect(all.querySelector('input')?.getAttribute('data-indeterminate')).toBe('true');
    expect(screen.getByRole('option', { name: 'blue' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });

    mocks.source.current = graph;
    rerender(<CrossplaneMap />);
    await waitFor(() =>
      expect(screen.getByTestId('nodes').textContent).toBe('parent,grandchild,leaf')
    );
    expect(filter.textContent).toBe('blue');
    expect(screen.getByText('3 of 4 resources match filters')).toBeTruthy();
  });

  it('removes a category restriction through All when only its selected category remains', async () => {
    const { rerender } = await renderBlueFilter();
    const graph = filteringGraph();
    mocks.source.current = {
      ...graph,
      nodes: graph.nodes.filter(node => node.id !== 'child'),
      edges: graph.edges.filter(edge => edge.source !== 'child' && edge.target !== 'child'),
    };
    rerender(<CrossplaneMap />);
    await waitFor(() =>
      expect(screen.getByTestId('nodes').textContent).toBe('parent,grandchild,leaf')
    );

    selectOption('Common Label', 'All');
    expect(screen.getByRole('combobox', { name: 'Common Label' }).textContent).toBe('All');
    expect(screen.queryByText(/resources match filters/)).toBeNull();
    mocks.source.current = graph;
    rerender(<CrossplaneMap />);
    await waitFor(() =>
      expect(screen.getByTestId('nodes').textContent).toBe('parent,child,grandchild,leaf')
    );
  });

  it('retains an explicit category selection while its resources disappear and return', async () => {
    const { rerender } = await renderBlueFilter();
    const graph = filteringGraph();
    mocks.source.current = {
      ...graph,
      nodes: graph.nodes.filter(node => node.id === 'child'),
      edges: [],
    };
    rerender(<CrossplaneMap />);
    await waitFor(() => expect(screen.getByTestId('nodes').textContent).toBe(''));
    expect(screen.getByText('No resources match the selected filters.')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Common Label' }));
    expect(screen.getByRole('option', { name: 'All' }).getAttribute('aria-selected')).toBe('false');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });

    mocks.source.current = graph;
    rerender(<CrossplaneMap />);
    await waitFor(() =>
      expect(screen.getByTestId('nodes').textContent).toBe('parent,grandchild,leaf')
    );
    expect(screen.getByRole('combobox', { name: 'Common Label' }).textContent).toBe('blue');
    expect(screen.getByText('3 of 4 resources match filters')).toBeTruthy();
  });

  it.each(['All', 'None'])(
    'applies the next status filter after clearing categories with %s',
    async option => {
      await renderBlueFilter();
      if (option === 'All') selectOption('Common Label', 'All');
      else selectOption('Categorize by', 'None');
      await waitFor(() => expect(mocks.nodes).toHaveLength(4));
      selectStatus('Healthy');
      await waitFor(() =>
        expect(mocks.nodes.map(node => node.id)).toEqual(['parent', 'grandchild', 'leaf'])
      );
    }
  );

  it('keeps the camera unchanged through empty matches and the next non-empty filter result', async () => {
    const { viewport } = await renderBlueFilter();
    selectStatus('Needs Attention');
    await waitFor(() => expect(mocks.nodes).toHaveLength(0));
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
    selectStatus('Healthy');
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
  });

  it('clears a stale category filter when the selected label key disappears', async () => {
    const { rerender, viewport } = await renderBlueFilter();
    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({
        ...node,
        kubeObject: {
          ...node.kubeObject,
          metadata: { ...node.kubeObject.metadata, labels: { env: 'production' } },
        },
      })),
    };
    rerender(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    expect(screen.getByRole('combobox', { name: 'Label' }).textContent).toBe('env');
    expect(screen.getByRole('combobox', { name: 'Common Label' }).textContent).toBe('All');
    expect(screen.queryByText(/resources match filters/)).toBeNull();
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
  });

  it('does not relayout on reduced-motion preference changes or move the camera when filtering', async () => {
    const { rerender, viewport } = await renderFilteringGraph();
    const layouts = mocks.layout.mock.calls.length;
    mocks.reduceMotion = false;
    rerender(<CrossplaneMap />);
    mocks.reduceMotion = true;
    rerender(<CrossplaneMap />);
    expect(mocks.layout).toHaveBeenCalledTimes(layouts);
    selectTeam();
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
  });
});

describe('Crossplane map collapse with filtering', () => {
  it.each(['resource', 'aggregated'])(
    'keeps the %s card expandable when a filter excludes an intermediate child',
    async type => {
      mocks.renderNodeCards = true;
      const graph = filteringGraph();
      if (type === 'aggregated')
        graph.nodes.push({
          ...graph.nodes[0],
          id: 'other-parent',
          kubeObject: {
            ...graph.nodes[0].kubeObject,
            metadata: { ...graph.nodes[0].kubeObject.metadata, name: 'other-parent' },
          },
        });
      mocks.source.current = graph;
      render(<CrossplaneMap />);
      await waitFor(() => expect(mocks.nodes).toHaveLength(graph.nodes.length));
      if (type === 'aggregated') {
        fireEvent.click(screen.getByRole('button', { name: 'Group all' }));
        await waitFor(() => expect(mocks.nodes).toHaveLength(4));
      }
      const resourceName =
        type === 'aggregated' ? '2 Resource resources from example.org' : 'parent';
      fireEvent.click(screen.getByRole('button', { name: `Collapse children of ${resourceName}` }));
      selectTeam();
      await waitFor(() => expect(node('child')).toBeUndefined());
      expect(node('grandchild').hidden).toBe(true);
      expect(node('leaf').hidden).toBe(true);
      const expand = screen.getByRole('button', { name: `Expand children of ${resourceName}` });
      fireEvent.click(expand);
      expect(node('grandchild').hidden).toBe(false);
      expect(node('leaf').hidden).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: `Collapse children of ${resourceName}` }));
      expect(node('grandchild').hidden).toBe(true);
    }
  );

  it('collapses across an excluded intermediate resource and expands without relayout', async () => {
    await renderBlueFilter();
    const before = positions();
    const layouts = mocks.layout.mock.calls.length;
    act(() => node('parent').data.onToggleCollapse('parent'));
    expect(screen.getByTestId('nodes').textContent).toBe('parent');
    expect(node('child')).toBeUndefined();
    expect(node('grandchild').hidden).toBe(true);
    expect(node('leaf').hidden).toBe(true);
    expect(node('grandchild').domAttributes).toMatchObject({ 'aria-hidden': true, inert: '' });
    expect(mocks.edges.every(edge => edge.hidden && edge.domAttributes['aria-hidden'])).toBe(true);
    act(() => node('parent').data.onToggleCollapse('parent'));
    expect(screen.getByTestId('nodes').textContent).toBe('parent,grandchild,leaf');
    expect(positions()).toEqual(before);
    expect(mocks.layout).toHaveBeenCalledTimes(layouts);
  });

  it('ignores a non-matching stored collapse root and restores it when the filter is removed', async () => {
    await renderFilteringGraph();
    act(() => node('child').data.onToggleCollapse('child'));
    expect(screen.getByTestId('nodes').textContent).toBe('parent,child');
    selectTeam();
    await waitFor(() =>
      expect(screen.getByTestId('nodes').textContent).toBe('parent,grandchild,leaf')
    );
    expect(node('grandchild').domAttributes.inert).toBeUndefined();
    expect(node('grandchild').data.childNodeCount).toBe(1);
    selectOption('Common Label', 'All');
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    expect(screen.getByTestId('nodes').textContent).toBe('parent,child');
    expect(node('child').data.collapsed).toBe(true);
    expect(node('grandchild').hidden).toBe(true);
  });

  it('preserves nested collapse entries when a matching ancestor expands', async () => {
    await renderBlueFilter();
    act(() => node('grandchild').data.onToggleCollapse('grandchild'));
    act(() => node('parent').data.onToggleCollapse('parent'));
    expect(screen.getByTestId('nodes').textContent).toBe('parent');
    act(() => node('parent').data.onToggleCollapse('parent'));
    expect(screen.getByTestId('nodes').textContent).toBe('parent,grandchild');
    expect(node('grandchild').data).toMatchObject({ collapsed: true, childNodeCount: 1 });
    expect(node('leaf').hidden).toBe(true);
  });
});

describe('Crossplane map filter layout transitions', () => {
  it('performs the initial fit during a StrictMode mount', async () => {
    mocks.source.current = filteringGraph();
    render(
      <StrictMode>
        <CrossplaneMap />
      </StrictMode>
    );
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
  });

  it('keeps the camera unchanged while waiting for and applying matching resources and routes', async () => {
    const { viewport } = await renderFilteringGraph();
    const pending = delayedLayouts();
    selectStatus('Healthy');
    expect(pending).toHaveLength(1);
    expect(pending[0].input.children.map((node: any) => node.id)).toEqual([
      'parent',
      'grandchild',
      'leaf',
    ]);
    expect(pending[0].input.edges.map((edge: any) => edge.id)).toEqual([
      'grandchild-leaf',
      'reference',
    ]);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
    await act(async () => pending[0].finish(50));
    expect(mocks.nodes.map(node => node.id)).toEqual(['parent', 'grandchild', 'leaf']);
    expect(mocks.edges.map(edge => edge.id)).toEqual(['grandchild-leaf', 'reference']);
    expect(node('grandchild').position).toEqual({ x: 410, y: 270 });
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
  });

  it('replaces an unfinished filter layout and ignores its late completion', async () => {
    const { viewport } = await renderFilteringGraph();
    const pending = delayedLayouts();
    selectStatus('Healthy');
    selectStatus('Needs Attention');
    expect(pending).toHaveLength(2);
    await act(async () => pending[1].finish(100));
    expect(mocks.nodes.map(node => node.id)).toEqual(['child']);
    expect(node('child').position).toEqual({ x: 100, y: 100 });
    const latest = positions();
    await act(async () => pending[0].finish(900));
    expect(positions()).toEqual(latest);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
  });

  it('cancels a queued initial fit when the filter changes without scheduling another fit', async () => {
    const resolved = vi.fn();
    mocks.fitView.mockImplementationOnce(
      options =>
        new Promise(resolve => {
          mocks.flowState.fitViewQueued = true;
          mocks.flowState.fitViewOptions = options;
          mocks.flowState.fitViewResolver = {
            resolve: (value: boolean) => {
              resolved(value);
              resolve(value);
            },
          };
        })
    );
    mocks.source.current = filteringGraph();
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.flowState.fitViewQueued).toBe(true));
    mocks.viewport = { x: 240, y: -60, zoom: 0.7 };
    const viewport = { ...mocks.viewport };
    selectStatus('Healthy');
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    expect(mocks.flowState.fitViewQueued).toBe(false);
    expect(mocks.flowState.fitViewOptions).toBeUndefined();
    expect(mocks.flowState.fitViewResolver).toBeNull();
    expect(resolved).toHaveBeenCalledWith(false);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
    for (const [next] of mocks.setViewport.mock.calls) expect(next).toEqual(viewport);
    expect(mocks.viewport).toEqual(viewport);
  });

  it.each(['user pan', 'native card focus', 'Zoom in', 'Zoom out'])(
    'preserves the current camera when a pending filter layout completes after %s',
    async interruption => {
      const { rerender } = await renderFilteringGraph();
      const pending = delayedLayouts();
      selectStatus('Healthy');
      expect(pending).toHaveLength(1);
      if (interruption === 'user pan')
        act(() => {
          mocks.viewport = { x: -320, y: 170, zoom: 0.9 };
          mocks.onMoveStart(new Event('wheel'));
        });
      else if (interruption === 'native card focus')
        act(() => screen.getByRole('button', { name: 'Open parent' }).focus());
      else fireEvent.click(screen.getByRole('button', { name: interruption }));
      const viewport = { ...mocks.viewport };
      await act(async () => pending[0].finish(50));
      expect(mocks.nodes).toHaveLength(3);
      expect(mocks.fitView).not.toHaveBeenCalled();
      expect(mocks.setViewport).not.toHaveBeenCalled();
      expect(mocks.viewport).toEqual(viewport);
      mocks.source.current = {
        ...filteringGraph(),
        edges: filteringGraph().edges.filter(edge => !edge.aux),
      };
      rerender(<CrossplaneMap />);
      await act(async () => pending[1].finish(100));
      expect(mocks.edges).toHaveLength(1);
      expect(mocks.fitView).not.toHaveBeenCalled();
      expect(mocks.setViewport).not.toHaveBeenCalled();
      expect(mocks.viewport).toEqual(viewport);
    }
  );

  it('does not restart the initial fit when its completion arrives after a filter reset', async () => {
    let finishOldFit!: (value: boolean) => void;
    mocks.fitView.mockImplementationOnce(() => new Promise(resolve => (finishOldFit = resolve)));
    mocks.source.current = filteringGraph();
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    mocks.viewport = { x: 240, y: -60, zoom: 0.7 };
    const viewport = { ...mocks.viewport };
    const pending = delayedLayouts();
    selectStatus('Healthy');
    selectStatus('All');
    expect(pending).toHaveLength(2);
    await act(async () => finishOldFit(true));
    await act(async () => pending[1].finish(100));
    expect(mocks.nodes).toHaveLength(4);
    const latest = positions();
    await act(async () => pending[0].finish(900));
    expect(positions()).toEqual(latest);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
    for (const [next] of mocks.setViewport.mock.calls) expect(next).toEqual(viewport);
    expect(mocks.viewport).toEqual(viewport);
  });

  it('keeps the current camera through successive live changes to the filtered graph', async () => {
    const { rerender, viewport } = await renderFilteringGraph();
    selectStatus('Healthy');
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    const pending = delayedLayouts();
    const graph = filteringGraph();
    mocks.source.current = {
      ...graph,
      nodes: graph.nodes.map(node => ({
        ...node,
        status: node.id === 'parent' ? 'error' : node.status,
      })),
    };
    rerender(<CrossplaneMap />);
    await act(async () => pending[0].finish(100));
    expect(mocks.nodes.map(node => node.id)).toEqual(['grandchild', 'leaf']);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
    mocks.source.current = graph;
    rerender(<CrossplaneMap />);
    await act(async () => pending[1].finish(200));
    expect(mocks.nodes.map(node => node.id)).toEqual(['parent', 'grandchild', 'leaf']);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
    mocks.source.current = { ...graph, edges: graph.edges.filter(edge => !edge.aux) };
    rerender(<CrossplaneMap />);
    await act(async () => pending[2].finish(300));
    expect(mocks.edges.map(edge => edge.id)).toEqual(['grandchild-leaf']);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
  });

  it('replaces pending filter geometry with live updates without changing the camera', async () => {
    const { rerender, viewport } = await renderFilteringGraph();
    const pending = delayedLayouts();
    selectStatus('Healthy');
    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({
        ...node,
        status: node.id === 'parent' ? 'error' : node.status,
      })),
    };
    rerender(<CrossplaneMap />);
    expect(pending).toHaveLength(2);
    await act(async () => pending[0].finish(700));
    expect(mocks.fitView).not.toHaveBeenCalled();
    await act(async () => pending[1].finish(100));
    expect(mocks.nodes.map(node => node.id)).toEqual(['grandchild', 'leaf']);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
    mocks.source.current = filteringGraph();
    rerender(<CrossplaneMap />);
    await act(async () => pending[2].finish(200));
    expect(mocks.nodes).toHaveLength(3);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
  });

  it('discards obsolete geometry after empty live matches and keeps the camera when matches return', async () => {
    const { rerender, viewport } = await renderFilteringGraph();
    const pending = delayedLayouts();
    selectStatus('Healthy');
    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({ ...node, status: 'error' })),
    };
    rerender(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(0));
    expect(pending).toHaveLength(1);
    await act(async () => pending[0].finish(1000));
    expect(mocks.nodes).toHaveLength(0);
    mocks.source.current = filteringGraph();
    rerender(<CrossplaneMap />);
    await act(async () => pending[1].finish(50));
    expect(mocks.nodes).toHaveLength(3);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
  });

  it('preserves selection and collapse across empty filter results', async () => {
    const { rerender } = await renderBlueFilter();
    act(() => {
      node('parent').data.onOpenDetails();
      node('parent').data.onToggleCollapse('parent');
    });
    mocks.fitView.mockClear();
    selectStatus('Needs Attention');
    await waitFor(() => expect(mocks.nodes).toHaveLength(0));
    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({ ...node, status: 'error' })),
    };
    rerender(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    expect(node('parent').selected).toBe(true);
    expect(node('parent').data.collapsed).toBe(true);
    expect(screen.getByTestId('nodes').textContent).toBe('parent');
    expect(mocks.fitView).not.toHaveBeenCalled();
    selectOption('Common Label', 'All');
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    expect(node('parent').selected).toBe(true);
    expect(node('parent').data.collapsed).toBe(true);
  });

  it('clears selection and collapse on actual source emptiness', async () => {
    const { rerender } = await renderBlueFilter();
    act(() => {
      node('parent').data.onOpenDetails();
      node('parent').data.onToggleCollapse('parent');
    });
    mocks.source.current = { nodes: [], edges: [] };
    rerender(<CrossplaneMap />);
    expect(screen.getByText('No Crossplane resources found.')).toBeTruthy();
    expect(mocks.nodes).toHaveLength(0);
    mocks.source.current = filteringGraph();
    rerender(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes.length).toBeGreaterThan(0));
    expect(mocks.nodes.every(node => !node.selected && !node.data.collapsed)).toBe(true);
  });

  it('replaces stale geometry when a label-key fallback clears a filter during layout', async () => {
    const { rerender, viewport } = await renderBlueFilter();
    const pending = delayedLayouts();
    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({
        ...node,
        kubeObject: {
          ...node.kubeObject,
          metadata: { ...node.kubeObject.metadata, namespace: 'team-a' },
        },
      })),
    };
    rerender(<CrossplaneMap />);
    expect(pending).toHaveLength(1);
    mocks.source.current = {
      ...mocks.source.current,
      nodes: mocks.source.current.nodes.map((node: any) => ({
        ...node,
        kubeObject: {
          ...node.kubeObject,
          metadata: { ...node.kubeObject.metadata, labels: { env: 'production' } },
        },
      })),
    };
    rerender(<CrossplaneMap />);
    expect(pending).toHaveLength(2);
    await act(async () => pending[1].finish(200));
    expect(mocks.nodes).toHaveLength(4);
    expect(node('parent').position).toEqual({ x: 200, y: 200 });
    const latest = positions();
    await act(async () => pending[0].finish(900));
    expect(positions()).toEqual(latest);
    expect(screen.getByRole('combobox', { name: 'Common Label' }).textContent).toBe('All');
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
  });

  it('keeps the camera unchanged through failed filter layout, metadata updates and explicit Retry', async () => {
    const { rerender, viewport } = await renderFilteringGraph();
    const pending = delayedLayouts();
    selectStatus('Healthy');
    await act(async () => pending[0].fail());
    expect(screen.getByRole('alert').textContent).toContain('Could not arrange the map.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({ ...node, providerName: 'updated-provider' })),
    };
    rerender(<CrossplaneMap />);
    expect(pending).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(pending).toHaveLength(2);
    await act(async () => pending[1].finish(50));
    expect(mocks.nodes).toHaveLength(3);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retries failed live geometry only after an explicit retry', async () => {
    const { rerender, viewport } = await renderBlueFilter();
    const pending = delayedLayouts();
    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({
        ...node,
        kubeObject: {
          ...node.kubeObject,
          metadata: { ...node.kubeObject.metadata, labels: { team: 'blue' } },
        },
      })),
    };
    rerender(<CrossplaneMap />);
    await act(async () => pending[0].fail());
    expect(mocks.fitView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => pending[1].finish());
    expect(mocks.nodes).toHaveLength(4);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
  });

  it('ignores delayed filter geometry and its viewport action after unmount', async () => {
    const { unmount, viewport } = await renderFilteringGraph();
    const pending = delayedLayouts();
    selectStatus('Healthy');
    unmount();
    await act(async () => pending[0].finish(900));
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
  });

  it('discards delayed filter geometry and resets filters when the cluster switches', async () => {
    const { rerender } = await renderFilteringGraph();
    const pending = delayedLayouts();
    selectStatus('Healthy');
    mocks.cluster.current = 'cluster-b';
    rerender(<CrossplaneMap />);
    expect(pending).toHaveLength(2);
    await act(async () => pending[1].finish(50));
    expect(mocks.nodes).toHaveLength(4);
    expect(screen.queryByText(/resources match filters/)).toBeNull();
    const latest = positions();
    await act(async () => pending[0].finish(900));
    expect(positions()).toEqual(latest);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
  });
});

describe('Crossplane map grouping', () => {
  function resource(id: string) {
    return {
      id,
      status: 'success',
      customResourceDefinition: 'resources.example.org',
      kubeObject: {
        apiVersion: 'example.org/v1',
        kind: id[0],
        metadata: { name: id },
      },
    };
  }

  function groupingGraph() {
    return {
      nodes: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D2'].map(resource),
      edges: [
        ['A1', 'B1'],
        ['A1', 'C1'],
        ['A2', 'B2'],
        ['A2', 'C2'],
        ['A2', 'D2'],
      ].map(([source, target]) => ({ id: `${source}-${target}`, source, target })),
    };
  }

  it.each(['completed', 'failed'])(
    'keeps deleted resources removed when a superseding global grouping layout is %s',
    async outcome => {
      const source = groupingGraph();
      mocks.source.current = { ...source, nodes: [...source.nodes, resource('X')] };
      const { rerender } = render(<CrossplaneMap />);
      await waitFor(() => expect(node('X')).toBeDefined());
      const pending = delayedLayouts();
      mocks.source.current = source;
      rerender(<CrossplaneMap />);
      expect(node('X')).toBeUndefined();
      const groupAll = screen.getByRole('button', { name: 'Group all' });
      expect(groupAll).toHaveProperty('disabled', false);
      fireEvent.click(groupAll);
      expect(node('X')).toBeUndefined();
      await act(async () => {
        if (outcome === 'failed') pending[1].fail();
        else pending[1].finish();
      });
      expect(node('X')).toBeUndefined();
      if (outcome === 'failed') expect(screen.getByText(/Could not arrange the map/)).toBeDefined();
      await act(async () => pending[0].finish());
      expect(node('X')).toBeUndefined();
    }
  );

  function splitParentGraph() {
    return {
      nodes: ['A1', 'A2', 'B1', 'B2', 'B3', 'B4'].map(resource),
      edges: [
        ['A1', 'B1'],
        ['A1', 'B2'],
        ['A2', 'B3'],
        ['A2', 'B4'],
      ].map(([source, target]) => ({ id: `${source}-${target}`, source, target })),
    };
  }

  function highlightedIds() {
    return mocks.nodes
      .filter(node => node.data.groupHighlighted)
      .map(node => node.id)
      .sort();
  }

  function visibleNames() {
    return mocks.nodes
      .map(node => (node.type === 'aggregated' ? `(${node.data.kind})` : node.id))
      .sort();
  }

  function visibleEdges() {
    const names = new Map(
      mocks.nodes.map(node => [
        node.id,
        node.type === 'aggregated' ? `(${node.data.kind})` : node.id,
      ])
    );
    return mocks.edges.map(edge => `${names.get(edge.source)}→${names.get(edge.target)}`).sort();
  }

  async function flushFocusFrame() {
    await act(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });
  }

  it('groups all resources and restores the original graph when groups are dissolved', async () => {
    const graph = groupingGraph();
    mocks.source.current = graph;
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(7));
    expect(mocks.nodes.map(node => node.id)).toEqual(graph.nodes.map(node => node.id));
    expect(mocks.edges.map(edge => edge.id)).toEqual(graph.edges.map(edge => edge.id));
    expect(screen.queryByRole('checkbox', { name: 'Group resources' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ungroup all' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Group all' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', '(B)', '(C)', 'D2']));
    expect(visibleEdges()).toEqual(['(A)→(B)', '(A)→(C)', '(A)→D2']);
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(
      mocks.nodes
        .filter(node => node.type === 'aggregated')
        .every(node => node.data.memberCount === 2 && node.data.healthyMemberCount === 2)
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Ungroup B' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', '(C)', 'B1', 'B2', 'D2']));
    expect(visibleEdges()).toEqual(['(A)→(C)', '(A)→B1', '(A)→B2', '(A)→D2']);

    fireEvent.click(screen.getByRole('button', { name: 'Ungroup A' }));
    await waitFor(() => expect(visibleNames()).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D2']));
    expect(visibleEdges()).toEqual(['A1→B1', 'A1→C1', 'A2→B2', 'A2→C2', 'A2→D2']);
    expect(mocks.nodes.map(node => node.id)).toEqual(graph.nodes.map(node => node.id));
    expect(mocks.edges.map(edge => edge.id)).toEqual(graph.edges.map(edge => edge.id));
    expect(mocks.openDetails).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', '(C)', 'B1', 'B2', 'D2']));
    const viewportCalls = mocks.setViewport.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Group all' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', '(B)', '(C)', 'D2']));
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup all' }));
    await waitFor(() =>
      expect(mocks.nodes.map(node => node.id)).toEqual(graph.nodes.map(node => node.id))
    );
    expect(mocks.edges.map(edge => edge.id)).toEqual(graph.edges.map(edge => edge.id));
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
    expect(mocks.setViewport).toHaveBeenCalledTimes(viewportCalls);
  });

  it('preserves collapsed children and their expand control through a pending or failed parent ungroup', async () => {
    mocks.source.current = splitParentGraph();
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(6));
    fireEvent.click(screen.getByRole('button', { name: 'Group all' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(2));
    const parentId = mocks.nodes.find(node => node.data.kind === 'A').id;
    const childrenId = mocks.nodes.find(node => node.data.kind === 'B').id;
    const previousPositions = positions();
    act(() => node(parentId).data.onToggleCollapse(parentId));
    const expectCollapsedDrawing = () => {
      expect(node(parentId).data).toMatchObject({ collapsed: true, childNodeCount: 1 });
      expect(node(parentId).domAttributes.inert).toBeUndefined();
      expect(node(childrenId).hidden).toBe(true);
      expect(node(childrenId).domAttributes).toMatchObject({ 'aria-hidden': true, inert: '' });
      expect(mocks.edges.every(edge => edge.hidden)).toBe(true);
      expect(screen.getByTestId('nodes').textContent).toBe(parentId);
      expect(positions()).toEqual(previousPositions);
    };
    expectCollapsedDrawing();
    const pending = delayedLayouts();
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup A' }));
    await waitFor(() => expect(pending).toHaveLength(1));
    expectCollapsedDrawing();
    await act(async () => pending[0].fail());
    expect(screen.getByRole('alert').textContent).toContain('Could not arrange the map');
    expectCollapsedDrawing();

    act(() => node(parentId).data.onToggleCollapse(parentId));
    expect(node(parentId).data).toMatchObject({ collapsed: false, childNodeCount: 1 });
    expect(node(childrenId).hidden).toBe(false);
    expect(node(childrenId).domAttributes.inert).toBeUndefined();
    expect(mocks.edges.every(edge => !edge.hidden)).toBe(true);
    expect(positions()).toEqual(previousPositions);
    expect(pending).toHaveLength(1);
    act(() => node(parentId).data.onToggleCollapse(parentId));
    expectCollapsedDrawing();
    expect(pending).toHaveLength(1);
  });

  it('collapses nested groups without relayout and preserves their independent collapse state', async () => {
    mocks.source.current = {
      nodes: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'X1'].map(resource),
      edges: [
        ...[
          ['A1', 'B1'],
          ['A2', 'B2'],
          ['B1', 'C1'],
          ['B2', 'C2'],
          ['C1', 'D1'],
          ['C2', 'D2'],
        ].map(([source, target]) => ({ id: `${source}-${target}`, source, target })),
        { id: 'reference', source: 'A1', target: 'X1', aux: true },
      ],
    };
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(9));
    fireEvent.click(screen.getByRole('button', { name: 'Group all' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(5));
    const aggregate = (kind: string) => mocks.nodes.find(node => node.data.kind === kind);
    const toggle = (kind: string) => {
      const group = aggregate(kind);
      act(() => group.data.onToggleCollapse(group.id));
    };
    const before = positions();
    const layouts = mocks.layout.mock.calls.length;
    const viewportCalls = mocks.setViewport.mock.calls.length;
    expect(aggregate('A').data).toMatchObject({ childNodeCount: 1, collapsed: false });
    expect(aggregate('D').data.childNodeCount).toBe(0);

    toggle('B');
    expect(aggregate('C').hidden).toBe(true);
    expect(aggregate('D').domAttributes).toMatchObject({ 'aria-hidden': true, inert: '' });
    toggle('A');
    expect(aggregate('B').hidden).toBe(true);
    expect(node('X1').hidden).toBe(false);
    toggle('A');
    expect(aggregate('B').hidden).toBe(false);
    expect(aggregate('B').data.collapsed).toBe(true);
    expect(aggregate('C').hidden).toBe(true);
    toggle('B');
    expect(mocks.nodes.every(node => !node.hidden)).toBe(true);
    expect(mocks.edges.every(edge => !edge.hidden)).toBe(true);
    expect(positions()).toEqual(before);
    expect(mocks.layout).toHaveBeenCalledTimes(layouts);
    expect(mocks.setViewport).toHaveBeenCalledTimes(viewportCalls);
  });

  it('keeps collapse on member resources across grouping and ungrouping', async () => {
    mocks.source.current = splitParentGraph();
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(6));
    act(() => {
      node('A1').data.onToggleCollapse('A1');
      node('A2').data.onToggleCollapse('A2');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(5));
    const group = mocks.nodes.find(node => node.type === 'aggregated');
    expect(group.data).toMatchObject({ collapsed: true, childNodeCount: 4 });
    expect(mocks.nodes.filter(node => node.hidden).map(node => node.id)).toEqual([
      'B1',
      'B2',
      'B3',
      'B4',
    ]);
    act(() => group.data.onToggleCollapse(group.id));
    expect(mocks.nodes.every(node => !node.hidden)).toBe(true);
    act(() => group.data.onToggleCollapse(group.id));
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup A' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(6));
    expect(node('A1').data.collapsed).toBe(true);
    expect(node('A2').data.collapsed).toBe(true);
    expect(screen.getByTestId('nodes').textContent).toBe('A1,A2');
    act(() => node('A1').data.onToggleCollapse('A1'));
    expect(screen.getByTestId('nodes').textContent).toBe('A1,A2,B1,B2');
  });

  it('ignores childless members when expanding a group whose branches are already collapsed', async () => {
    mocks.source.current = {
      nodes: ['A1', 'A2', 'B1'].map(resource),
      edges: [{ id: 'child', source: 'A1', target: 'B1' }],
    };
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    act(() => node('A1').data.onToggleCollapse('A1'));
    fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(2));
    const group = mocks.nodes.find(node => node.type === 'aggregated');
    expect(group.data).toMatchObject({ collapsed: true, childNodeCount: 1 });
    act(() => group.data.onToggleCollapse(group.id));
    expect(node('B1').hidden).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup A' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    expect(node('A1').data.collapsed).toBe(false);
    expect(node('A2').data.collapsed).toBe(false);
  });

  it('applies group collapse only to matching members and restores filtered member state', async () => {
    mocks.source.current = {
      nodes: ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'].map(id => ({
        ...resource(id),
        status: id === 'A2' ? 'error' : 'success',
      })),
      edges: ['1', '2', '3'].map(suffix => ({
        id: suffix,
        source: `A${suffix}`,
        target: `B${suffix}`,
      })),
    };
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(6));
    fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    let group = mocks.nodes.find(node => node.type === 'aggregated');
    act(() => group.data.onToggleCollapse(group.id));
    expect(screen.getByTestId('nodes').textContent).toBe(group.id);

    selectStatus('Healthy');
    await waitFor(() =>
      expect(mocks.nodes.find(node => node.type === 'aggregated').data.memberCount).toBe(2)
    );
    group = mocks.nodes.find(node => node.type === 'aggregated');
    expect(group.data.collapsed).toBe(true);
    expect(node('B1').hidden).toBe(true);
    expect(node('B2').hidden).toBe(false);
    expect(node('B3').hidden).toBe(true);
    act(() => group.data.onToggleCollapse(group.id));
    expect(mocks.nodes.every(node => !node.hidden)).toBe(true);

    selectStatus('All');
    await waitFor(() =>
      expect(mocks.nodes.find(node => node.type === 'aggregated').data.memberCount).toBe(3)
    );
    expect(node('B2').hidden).toBe(true);
    expect(node('B1').hidden).toBe(false);
    expect(node('B3').hidden).toBe(false);
  });

  it.each(['group', 'ungroup'])(
    'updates live resource and aggregate data while a failed %s layout retains geometry',
    async action => {
      const graph = groupingGraph();
      mocks.source.current = graph;
      const { rerender } = render(<CrossplaneMap />);
      await waitFor(() => expect(mocks.nodes).toHaveLength(graph.nodes.length));
      if (action === 'ungroup') {
        fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
        await waitFor(() => expect(mocks.nodes).toHaveLength(6));
      }
      const previousPositions = positions();
      const previousEdgeIds = mocks.edges.map(edge => edge.id);
      const fitCalls = mocks.fitView.mock.calls.length;
      const pending = delayedLayouts();
      fireEvent.click(
        screen.getByRole('button', { name: action === 'group' ? 'Group A1' : 'Ungroup A' })
      );
      await waitFor(() => expect(pending).toHaveLength(1));
      await act(async () => pending[0].fail());
      expect(screen.getByRole('alert').textContent).toContain('Could not arrange the map');

      mocks.source.current = {
        ...graph,
        nodes: graph.nodes.map(node => ({
          ...node,
          status: 'error',
          providerName: 'updated-provider',
          kubeObject: {
            ...node.kubeObject,
            metadata: { ...node.kubeObject.metadata, labels: { team: 'updated-team' } },
          },
        })),
      };
      rerender(<CrossplaneMap />);
      const resources = mocks.nodes.filter(node => node.type === 'resource');
      expect(resources).toHaveLength(action === 'group' ? 7 : 5);
      expect(resources.every(node => node.data.status === 'error')).toBe(true);
      expect(resources.every(node => node.data.categoryLabel === 'example.org')).toBe(true);
      if (action === 'ungroup') {
        expect(mocks.nodes.find(node => node.type === 'aggregated').data).toMatchObject({
          memberCount: 2,
          healthyMemberCount: 0,
        });
      }
      expect(positions()).toEqual(previousPositions);
      expect(mocks.edges.map(edge => edge.id)).toEqual(previousEdgeIds);
      expect(pending).toHaveLength(1);
      expect(mocks.fitView).toHaveBeenCalledTimes(fitCalls);
      fireEvent.click(screen.getByRole('button', { name: 'Open B1' }));
      expect(mocks.openDetails).toHaveBeenLastCalledWith(
        expect.objectContaining({ name: 'B1', providerName: 'updated-provider' })
      );
    }
  );

  it('updates group health from live member statuses without regrouping or relayout', async () => {
    const graph = { nodes: ['A1', 'A2', 'A3'].map(resource), edges: [] };
    mocks.source.current = graph;
    const { rerender } = render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Group all' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)']));
    const groupId = mocks.nodes[0].id;
    const layoutCalls = mocks.layout.mock.calls.length;
    expect(mocks.nodes[0].data).toMatchObject({ memberCount: 3, healthyMemberCount: 3 });

    mocks.source.current = {
      ...graph,
      nodes: graph.nodes.map(node => (node.id === 'A3' ? { ...node, status: 'error' } : node)),
    };
    rerender(<CrossplaneMap />);
    expect(mocks.nodes[0].data).toMatchObject({ memberCount: 3, healthyMemberCount: 2 });

    mocks.source.current = {
      ...graph,
      nodes: graph.nodes.map(node => ({ ...node, status: 'error' })),
    };
    rerender(<CrossplaneMap />);
    expect(mocks.nodes[0].data).toMatchObject({ memberCount: 3, healthyMemberCount: 0 });
    expect(mocks.nodes[0].id).toBe(groupId);
    expect(mocks.layout).toHaveBeenCalledTimes(layoutCalls);
  });

  it('previews and groups only current candidates, recalculating them after a parent split', async () => {
    mocks.source.current = splitParentGraph();
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(6));
    const layoutCalls = mocks.layout.mock.calls.length;
    const fitCalls = mocks.fitView.mock.calls.length;
    const viewportCalls = mocks.setViewport.mock.calls.length;
    const originalPositions = positions();
    const a1 = screen.getByRole('button', { name: 'Open A1' }).closest('.react-flow__node')!;

    fireEvent.mouseEnter(a1);
    expect(highlightedIds()).toEqual([]);
    const groupA = screen.getByRole('button', { name: 'Group A1' });
    fireEvent.mouseEnter(groupA);
    expect(highlightedIds()).toEqual(['A1', 'A2']);
    expect(node('A1').data.candidateMemberCount).toBe(2);
    expect(mocks.nodes.every(node => !node.selected)).toBe(true);
    expect(positions()).toEqual(originalPositions);
    expect(mocks.layout).toHaveBeenCalledTimes(layoutCalls);
    expect(mocks.fitView).toHaveBeenCalledTimes(fitCalls);
    expect(mocks.setViewport).toHaveBeenCalledTimes(viewportCalls);
    fireEvent.mouseLeave(groupA);
    expect(highlightedIds()).toEqual([]);

    act(() => groupA.focus());
    expect(highlightedIds()).toEqual([]);
    act(() => groupA.blur());
    expect(highlightedIds()).toEqual([]);
    fireEvent.click(groupA);
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', 'B1', 'B2', 'B3', 'B4']));
    const b1 = screen.getByRole('button', { name: 'Group B1' });
    fireEvent.mouseEnter(b1);
    expect(highlightedIds()).toEqual(['B1', 'B2', 'B3', 'B4']);
    expect(node('B1').data.candidateMemberCount).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: 'Group B1' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', '(B)']));
    expect(mocks.nodes.find(node => node.data.kind === 'B').data.memberCount).toBe(4);

    fireEvent.click(screen.getByRole('button', { name: 'Ungroup B' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(5));
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup A' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(6));
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Group B1' }));
    expect(highlightedIds()).toEqual(['B1', 'B2']);
    expect(node('B1').data.candidateMemberCount).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Group B1' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(B)', 'A1', 'A2', 'B3', 'B4']));
    expect(mocks.nodes.find(node => node.type === 'aggregated').data.memberCount).toBe(2);
  });

  it('keeps independently grouped children separate when their parents are grouped', async () => {
    mocks.source.current = splitParentGraph();
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(6));
    fireEvent.click(screen.getByRole('button', { name: 'Group B1' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(5));
    fireEvent.click(screen.getByRole('button', { name: 'Group B3' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', '(B)', '(B)']));
    expect(
      mocks.nodes.filter(node => node.data.kind === 'B').map(node => node.data.memberCount)
    ).toEqual([2, 2]);

    fireEvent.click(screen.getAllByRole('button', { name: 'Group B' })[0]);
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', '(B)']));
    expect(mocks.nodes.find(node => node.data.kind === 'B').data.memberCount).toBe(4);
  });

  it('keeps newly discovered resources individual until explicitly grouped', async () => {
    mocks.source.current = groupingGraph();
    const { rerender } = render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(7));
    fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(6));
    await act(async () => {
      mocks.source.current = {
        ...mocks.source.current,
        nodes: [...mocks.source.current.nodes, resource('A3')],
      };
      rerender(<CrossplaneMap />);
    });
    await waitFor(() =>
      expect(visibleNames()).toEqual(['(A)', 'A3', 'B1', 'B2', 'C1', 'C2', 'D2'])
    );
    expect(mocks.nodes.find(node => node.type === 'aggregated').data.memberCount).toBe(2);
    expect(node('A3').data.candidateMemberCount).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'Group A3' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', 'B1', 'B2', 'C1', 'C2', 'D2']));
    expect(mocks.nodes.find(node => node.type === 'aggregated').data.memberCount).toBe(3);
  });

  it('preserves unrelated detail selection and collapsed branches across grouping actions', async () => {
    const grouped = groupingGraph();
    const unrelated = loadedGraph();
    mocks.source.current = {
      nodes: [...grouped.nodes, ...unrelated.nodes],
      edges: [...grouped.edges, ...unrelated.edges],
    };
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(9));
    fireEvent.click(screen.getByRole('button', { name: 'Open parent' }));
    act(() => node('parent').data.onToggleCollapse('parent'));
    expect(node('parent').selected).toBe(true);
    expect(node('child').hidden).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(8));
    expect(node('parent').selected).toBe(true);
    expect(node('parent').data.collapsed).toBe(true);
    expect(node('child').hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup all' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(9));
    expect(node('parent').selected).toBe(true);
    expect(node('parent').data.collapsed).toBe(true);
    expect(node('child').hidden).toBe(true);
    expect(mocks.openDetails).toHaveBeenCalledOnce();
  });

  it('keeps filters active on aggregates and restores membership after singleton and empty projections', async () => {
    const graph = {
      nodes: [resource('A1'), { ...resource('A2'), status: 'error' }, resource('A3')],
      edges: [],
    };
    mocks.source.current = graph;
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Group all' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)']));
    const fullGroupId = mocks.nodes[0].id;
    mocks.viewport = { x: 240, y: -60, zoom: 0.7 };
    const viewport = { ...mocks.viewport };
    mocks.fitView.mockClear();
    mocks.setViewport.mockClear();
    expect(mocks.nodes[0].data.memberCount).toBe(3);
    expect(mocks.nodes[0].data.healthyMemberCount).toBe(2);
    expect(screen.getByRole('combobox', { name: 'Status' }).getAttribute('aria-disabled')).not.toBe(
      'true'
    );
    expect(
      screen.getByRole('combobox', { name: 'Provider' }).getAttribute('aria-disabled')
    ).not.toBe('true');

    selectStatus('Healthy');
    await waitFor(() => expect(mocks.nodes[0]?.data.memberCount).toBe(2));
    expect(mocks.nodes[0].data.healthyMemberCount).toBe(2);
    expect(visibleNames()).toEqual(['(A)']);
    expect(screen.getByText('2 of 3 resources match filters')).toBeTruthy();

    selectStatus('Needs Attention');
    await waitFor(() => expect(visibleNames()).toEqual(['A2']));
    expect(node('A2').data.onGroup).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Ungroup A' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Group all' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Ungroup all' })).toHaveProperty('disabled', true);
    expect(screen.getByText('1 of 3 resources match filters')).toBeTruthy();

    selectOption('Status', 'Needs Attention');
    await waitFor(() => expect(mocks.nodes).toHaveLength(0));
    expect(screen.getByText('No resources match the selected filters.')).toBeTruthy();
    selectStatus('All');
    await waitFor(() => expect(visibleNames()).toEqual(['(A)']));
    expect(mocks.nodes[0].id).toBe(fullGroupId);
    expect(mocks.nodes[0].data.memberCount).toBe(3);
    expect(mocks.nodes[0].data.healthyMemberCount).toBe(2);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.viewport).toEqual(viewport);
  });

  it.each(['local', 'all'])(
    'groups only matching resources through the %s action',
    async action => {
      mocks.source.current = {
        nodes: [resource('A1'), { ...resource('A2'), status: 'error' }, resource('A3')],
        edges: [],
      };
      render(<CrossplaneMap />);
      await waitFor(() => expect(mocks.nodes).toHaveLength(3));
      selectStatus('Healthy');
      await waitFor(() => expect(visibleNames()).toEqual(['A1', 'A3']));
      expect(node('A1').data.candidateMemberCount).toBe(2);
      fireEvent.click(
        screen.getByRole('button', { name: action === 'local' ? 'Group A1' : 'Group all' })
      );
      await waitFor(() => expect(visibleNames()).toEqual(['(A)']));
      expect(mocks.nodes[0].data.memberCount).toBe(2);
      selectStatus('All');
      await waitFor(() => expect(visibleNames()).toEqual(['(A)', 'A2']));
      expect(mocks.nodes.find(node => node.type === 'aggregated').data.memberCount).toBe(2);
    }
  );

  it('restores an expanded subgroup without absorbing another matching sibling', async () => {
    mocks.source.current = {
      nodes: [resource('A1'), resource('A2'), { ...resource('A3'), status: 'error' }],
      edges: [],
    };
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    selectStatus('Healthy');
    await waitFor(() => expect(visibleNames()).toEqual(['A1', 'A2']));
    fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)']));
    selectStatus('All');
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', 'A3']));
    const groupedId = mocks.nodes.find(node => node.type === 'aggregated').id;
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup A' }));
    await waitFor(() => expect(visibleNames()).toEqual(['A1', 'A2', 'A3']));
    expect(node('A1').data.candidateMemberCount).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', 'A3']));
    expect(mocks.nodes.find(node => node.type === 'aggregated').id).toBe(groupedId);
  });

  it('keeps grouping candidates separated by their original hidden parents', async () => {
    mocks.source.current = {
      nodes: [
        { ...resource('A1'), status: 'error' },
        { ...resource('A2'), status: 'error' },
        resource('B1'),
        resource('B2'),
      ],
      edges: [
        { id: 'A1-B1', source: 'A1', target: 'B1' },
        { id: 'A2-B2', source: 'A2', target: 'B2' },
      ],
    };
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    selectStatus('Healthy');
    await waitFor(() => expect(visibleNames()).toEqual(['B1', 'B2']));
    expect(mocks.edges).toHaveLength(0);
    expect(node('B1').data.onGroup).toBeUndefined();
    expect(node('B2').data.onGroup).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Group all' })).toHaveProperty('disabled', true);
  });

  it('removes connections from excluded group members without removing their matching children', async () => {
    mocks.source.current = {
      nodes: [
        resource('A1'),
        resource('A2'),
        { ...resource('A3'), status: 'error' },
        resource('B1'),
        resource('B2'),
        { ...resource('B3'), status: 'error' },
      ],
      edges: [
        { id: 'A3-B1', source: 'A3', target: 'B1' },
        { id: 'A3-B2', source: 'A3', target: 'B2' },
        { id: 'A1-B3', source: 'A1', target: 'B3' },
      ],
    };
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(6));
    fireEvent.click(screen.getByRole('button', { name: 'Group all' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', '(B)']));
    expect(visibleEdges()).toEqual(['(A)→(B)']);
    selectStatus('Healthy');
    await waitFor(() => expect(mocks.nodes.map(node => node.data.memberCount)).toEqual([2, 2]));
    expect(visibleNames()).toEqual(['(A)', '(B)']);
    expect(mocks.edges).toHaveLength(0);
    selectStatus('All');
    await waitFor(() => expect(mocks.nodes.map(node => node.data.memberCount)).toEqual([3, 3]));
    expect(visibleEdges()).toEqual(['(A)→(B)']);
  });

  it.each(['local', 'all'])(
    'roundtrips matching parents and descendants through %s grouping',
    async action => {
      const graph = splitParentGraph();
      mocks.source.current = {
        ...graph,
        nodes: graph.nodes.map(node =>
          ['B2', 'B4'].includes(node.id) ? { ...node, status: 'error' } : node
        ),
      };
      render(<CrossplaneMap />);
      await waitFor(() => expect(mocks.nodes).toHaveLength(6));
      selectStatus('Healthy');
      await waitFor(() => expect(visibleNames()).toEqual(['A1', 'A2', 'B1', 'B3']));
      const originalEdges = visibleEdges();
      fireEvent.click(
        screen.getByRole('button', { name: action === 'local' ? 'Group A1' : 'Group all' })
      );
      await waitFor(() =>
        expect(visibleNames()).toEqual(action === 'local' ? ['(A)', 'B1', 'B3'] : ['(A)', '(B)'])
      );
      expect(screen.getByText('4 of 6 resources match filters')).toBeTruthy();
      fireEvent.click(
        screen.getByRole('button', { name: action === 'local' ? 'Ungroup A' : 'Ungroup all' })
      );
      await waitFor(() => expect(visibleNames()).toEqual(['A1', 'A2', 'B1', 'B3']));
      expect(visibleEdges()).toEqual(originalEdges);
      expect(node('B1').data.onGroup).toBeUndefined();
      expect(node('B3').data.onGroup).toBeUndefined();
    }
  );

  it('restores a child group after its parent is ungrouped and regrouped with a fixed filter', async () => {
    const graph = splitParentGraph();
    mocks.source.current = {
      ...graph,
      nodes: graph.nodes.map(node =>
        ['B2', 'B4'].includes(node.id) ? { ...node, status: 'error' } : node
      ),
    };
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(6));
    selectStatus('Healthy');
    await waitFor(() => expect(visibleNames()).toEqual(['A1', 'A2', 'B1', 'B3']));
    fireEvent.click(screen.getByRole('button', { name: 'Group all' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', '(B)']));
    const childGroupId = mocks.nodes.find(node => node.data.kind === 'B').id;
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup A' }));
    await waitFor(() => expect(visibleNames()).toEqual(['A1', 'A2', 'B1', 'B3']));
    fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', '(B)']));
    expect(mocks.nodes.find(node => node.data.kind === 'B').id).toBe(childGroupId);
    expect(mocks.nodes.find(node => node.data.kind === 'B').data.memberCount).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'Ungroup B' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', 'B1', 'B3']));
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup A' }));
    await waitFor(() => expect(visibleNames()).toEqual(['A1', 'A2', 'B1', 'B3']));
    fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)', 'B1', 'B3']));
  });

  it('clears the hover preview on keyboard focus and follows local grouping actions', async () => {
    mocks.source.current = splitParentGraph();
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(6));
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Group A1' }));
    expect(highlightedIds()).toEqual(['A1', 'A2']);

    const groupB = screen.getByRole('button', { name: 'Group B1' });
    act(() => groupB.focus());
    expect(highlightedIds()).toEqual([]);
    fireEvent.click(groupB);
    await waitFor(() => expect(visibleNames()).toEqual(['(B)', 'A1', 'A2', 'B3', 'B4']));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ungroup B' }))
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ungroup B' }));
    await waitFor(() => expect(mocks.nodes).toHaveLength(6));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Group B1' }))
    );
    expect(highlightedIds()).toEqual([]);
  });

  it.each(['another node', 'pan', 'zoom', 'global action'])(
    'does not restore pending group focus after the user chooses %s',
    async interruption => {
      mocks.source.current = groupingGraph();
      render(<CrossplaneMap />);
      await waitFor(() => expect(mocks.nodes).toHaveLength(7));
      const pending = delayedLayouts();
      const groupA = screen.getByRole('button', { name: 'Group A1' });
      act(() => groupA.focus());
      fireEvent.click(groupA);
      await waitFor(() => expect(pending).toHaveLength(1));

      if (interruption === 'another node') {
        act(() => screen.getByRole('button', { name: 'Open C1' }).focus());
      } else if (interruption === 'pan') {
        act(() => mocks.onMoveStart(new Event('pointermove')));
      } else if (interruption === 'zoom') {
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Group all' }));
        await waitFor(() => expect(pending).toHaveLength(2));
        await act(async () => pending[1].finish(300));
      }
      await act(async () => pending[0].finish(100));
      await flushFocusFrame();
      expect(document.activeElement).toBe(
        interruption === 'another node'
          ? screen.getByRole('button', { name: 'Open C1' })
          : document.body
      );
    }
  );

  it('does not restore a failed group action’s focus when its layout is retried', async () => {
    mocks.source.current = groupingGraph();
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(7));
    const pending = delayedLayouts();
    const groupA = screen.getByRole('button', { name: 'Group A1' });
    act(() => groupA.focus());
    fireEvent.click(groupA);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].fail());
    expect(screen.getByRole('alert').textContent).toContain('Could not arrange the map');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1].finish(200));
    await flushFocusFrame();
    expect(visibleNames()).toEqual(['(A)', 'B1', 'B2', 'C1', 'C2', 'D2']);
    expect(document.activeElement).toBe(document.body);
  });

  it('focuses a matching member after ungrouping with an active filter', async () => {
    mocks.source.current = {
      nodes: [{ ...resource('A1'), status: 'error' }, resource('A2'), resource('A3')],
      edges: [],
    };
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    selectStatus('Healthy');
    await waitFor(() => expect(visibleNames()).toEqual(['A2', 'A3']));
    fireEvent.click(screen.getByRole('button', { name: 'Group all' }));
    await waitFor(() => expect(visibleNames()).toEqual(['(A)']));
    const pending = delayedLayouts();
    const ungroup = screen.getByRole('button', { name: 'Ungroup A' });
    act(() => ungroup.focus());
    fireEvent.click(ungroup);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].finish());
    await flushFocusFrame();
    expect(node('A1')).toBeUndefined();
    expect(visibleNames()).toEqual(['A2', 'A3']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Group A2' }));
  });

  it.each(['group', 'ungroup'])(
    'retains the complete last drawing while a local %s layout is pending or failed',
    async action => {
      mocks.source.current = groupingGraph();
      render(<CrossplaneMap />);
      await waitFor(() => expect(mocks.nodes).toHaveLength(7));
      if (action === 'ungroup') {
        fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
        await waitFor(() => expect(mocks.nodes).toHaveLength(6));
      }
      const previousPositions = positions();
      const previousEdges = mocks.edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        points: edge.data.points,
      }));
      const expectPreviousDrawing = () => {
        expect(positions()).toEqual(previousPositions);
        expect(
          mocks.edges.map(edge => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            points: edge.data.points,
          }))
        ).toEqual(previousEdges);
      };
      const pending = delayedLayouts();
      fireEvent.click(
        screen.getByRole('button', { name: action === 'group' ? 'Group A1' : 'Ungroup A' })
      );
      await waitFor(() => expect(pending).toHaveLength(1));
      expectPreviousDrawing();
      await act(async () => pending[0].fail());
      expect(screen.getByRole('alert').textContent).toContain('Could not arrange the map');
      expectPreviousDrawing();

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(pending).toHaveLength(2));
      expectPreviousDrawing();
      await act(async () => pending[1].finish(200));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(visibleNames()).toEqual(
        action === 'group'
          ? ['(A)', 'B1', 'B2', 'C1', 'C2', 'D2']
          : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D2']
      );
      expect(mocks.edges).toHaveLength(5);
    }
  );

  describe('grouping motion', () => {
    const cardHeight = RESOURCE_NODE_LAYOUT_HEIGHT - 18;
    beforeEach(() => {
      mocks.reduceMotion = false;
      mocks.layout.mockImplementation(async input => positionedLayout(input));
      mockNodeMeasurements();
      mocks.setViewport.mockImplementation(async viewport => {
        mocks.viewport = { ...viewport };
        mocks.onMoveStart(undefined);
        return true;
      });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    function animationClock() {
      const callbacks = new Map<number, FrameRequestCallback>();
      let nextId = 1;
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      });
      vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
      return {
        async frame(time: number) {
          await act(async () => {
            for (const id of [...callbacks.keys()]) {
              const callback = callbacks.get(id);
              callbacks.delete(id);
              callback?.(time);
            }
          });
        },
      };
    }

    async function renderMotionGraph() {
      const graph = {
        nodes: ['P', 'A1', 'A2', 'B1', 'B2'].map(resource),
        edges: [
          ['P', 'A1'],
          ['P', 'A2'],
          ['A1', 'B1'],
          ['A2', 'B2'],
        ].map(([source, target]) => ({ id: `${source}-${target}`, source, target })),
      };
      mocks.source.current = graph;
      const result = render(<CrossplaneMap />);
      await waitFor(() => expect(mocks.nodes).toHaveLength(5));
      await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
      return { ...result, graph };
    }

    function layoutPositions(layout: any) {
      return layout.children.map(({ id, x, y }: any) => ({ id, position: { x, y } }));
    }

    function screenPosition(id: string) {
      const { x, y } = node(id).position;
      const viewport = mocks.viewport;
      return { x: viewport.x + x * viewport.zoom, y: viewport.y + y * viewport.zoom };
    }

    function mockVisibleCardBounds() {
      mocks.viewport.zoom = 0.5;
      mockNodeMeasurements(cardHeight);
    }

    function mockNodeMeasurements(resourceHeight = RESOURCE_NODE_LAYOUT_HEIGHT) {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement
      ) {
        const visible = this.matches('.react-flow__node') ? node(this.dataset.id!) : undefined;
        if (!visible) return Element.prototype.getBoundingClientRect.call(this);
        const height = visible.type === 'aggregated' ? AGGREGATED_NODE_HEIGHT : resourceHeight;
        return {
          width: NODE_WIDTH * mocks.viewport.zoom,
          height: height * mocks.viewport.zoom,
        } as DOMRect;
      });
    }

    it.each([
      { category: 'None', reduceMotion: false },
      { category: 'Provider', reduceMotion: false },
      { category: 'None', reduceMotion: true },
      { category: 'Provider', reduceMotion: true },
    ])(
      'anchors the current member bounds after changing category to $category with reduceMotion=$reduceMotion',
      async ({ category, reduceMotion }) => {
        const clock = animationClock();
        mocks.reduceMotion = true;
        const { rerender } = await renderMotionGraph();
        mocks.viewport.zoom = 0.5;
        const categoryRowHeight = 22.8;
        const originalBounds = Element.prototype.getBoundingClientRect;
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
          this: HTMLElement
        ) {
          const current = this.matches('.react-flow__node') ? node(this.dataset.id!) : undefined;
          if (!current) return originalBounds.call(this);
          const height =
            current.type === 'aggregated'
              ? AGGREGATED_NODE_HEIGHT
              : current.data.categoryLabel
              ? cardHeight
              : cardHeight - categoryRowHeight;
          return {
            width: NODE_WIDTH * mocks.viewport.zoom,
            height: height * mocks.viewport.zoom,
          } as DOMRect;
        });
        if (category === 'Provider') {
          selectOption('Categorize by', 'None');
          await act(async () => {});
        }
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Group A2' }));
        });
        expect(node('A1')).toBeUndefined();
        expect(node('A2')).toBeUndefined();
        selectOption('Categorize by', category);
        await act(async () => {});
        const aggregate = mocks.nodes.find(node => node.type === 'aggregated');
        const anchor = screenPosition(aggregate.id);
        const zoom = mocks.viewport.zoom;
        const anchorCenter = {
          x: anchor.x + (NODE_WIDTH * zoom) / 2,
          y: anchor.y + (AGGREGATED_NODE_HEIGHT * zoom) / 2,
        };
        mocks.reduceMotion = reduceMotion;
        rerender(<CrossplaneMap />);
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Ungroup A' }));
        });
        function expectFixedCenter() {
          const elements = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].filter(
            element => ['A1', 'A2'].includes(element.dataset.id!)
          );
          expect(elements).toHaveLength(2);
          const corners = elements.map(element => ({
            ...screenPosition(element.dataset.id!),
            ...element.getBoundingClientRect(),
          }));
          const left = Math.min(...corners.map(point => point.x));
          const top = Math.min(...corners.map(point => point.y));
          const right = Math.max(...corners.map(point => point.x + point.width));
          const bottom = Math.max(...corners.map(point => point.y + point.height));
          expect((left + right) / 2).toBeCloseTo(anchorCenter.x, 8);
          expect((top + bottom) / 2).toBeCloseTo(anchorCenter.y, 8);
          expect(mocks.viewport.zoom).toBe(zoom);
          expect(mocks.fitView).toHaveBeenCalledTimes(1);
        }
        expectFixedCenter();
        if (!reduceMotion) {
          await clock.frame(0);
          await clock.frame(250);
          expectFixedCenter();
          await clock.frame(500);
          expectFixedCenter();
        }
      }
    );

    it('keeps the clicked card’s screen position through gathering, replacement and layout', async () => {
      const clock = animationClock();
      await renderMotionGraph();
      mocks.viewport = { x: 120, y: 80, zoom: 0.5 };
      mockVisibleCardBounds();
      const initial = positions();
      const source = new Map(initial.map(node => [node.id, node.position]));
      const anchor = source.get('A2')!;
      const anchorScreen = screenPosition('A2');
      let target: any;
      mocks.layout.mockImplementationOnce(async input => {
        target = positionedLayout(input, 900);
        return target;
      });
      const button = screen.getByRole('button', { name: 'Group A2' });
      act(() => button.focus());
      await act(async () => {
        fireEvent.click(button);
      });
      expect(positions()).toEqual(initial);
      expect(document.activeElement).toBe(document.body);
      expect(mocks.fitView).toHaveBeenCalledTimes(1);

      await clock.frame(0);
      await clock.frame(175);
      expect(node('A1').position).toEqual({
        x: (source.get('A1')!.x + anchor.x) / 2,
        y: (source.get('A1')!.y + anchor.y) / 2,
      });
      expect(node('A2').position).toEqual(anchor);
      expect(screenPosition('A2')).toEqual(anchorScreen);
      for (const id of ['P', 'B1', 'B2']) expect(node(id).position).toEqual(source.get(id));
      expect(mocks.nodes.every(node => node.type === 'resource')).toBe(true);
      expect(mocks.nodes.every(node => !node.className?.includes('fading'))).toBe(true);
      expect(mocks.edges.every(edge => !edge.className?.includes('fading'))).toBe(true);
      expect(mocks.fitView).toHaveBeenCalledTimes(1);

      await clock.frame(350);
      const aggregate = mocks.nodes.find(node => node.type === 'aggregated');
      const origin = anchor;
      expect(aggregate.position).toEqual(origin);
      expect(screenPosition(aggregate.id)).toEqual(anchorScreen);
      expect(mocks.setViewport).not.toHaveBeenCalled();
      expect(node('A1')).toBeUndefined();
      expect(node('A2')).toBeUndefined();
      for (const id of ['P', 'B1', 'B2']) expect(node(id).position).toEqual(source.get(id));
      expect(document.activeElement).toBe(document.body);
      expect(mocks.fitView).toHaveBeenCalledTimes(1);

      await clock.frame(366);
      await clock.frame(616);
      const aggregateTarget = target.children.find((node: any) => node.id === aggregate.id);
      expect(node(aggregate.id).position).toEqual({
        x: (origin.x + aggregateTarget.x) / 2,
        y: (origin.y + aggregateTarget.y) / 2,
      });
      expect(node('P').position).toEqual({ x: 450, y: 450 });
      expect(screenPosition(aggregate.id)).toEqual(anchorScreen);
      expect(mocks.viewport.zoom).toBe(0.5);
      expect(mocks.fitView).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(document.body);

      await clock.frame(866);
      expect(positions()).toEqual(layoutPositions(target));
      expect(mocks.fitView).toHaveBeenCalledTimes(1);
      expect(screenPosition(aggregate.id)).toEqual(anchorScreen);
      expect(mocks.viewport.zoom).toBe(0.5);
      expect(mocks.setViewport.mock.calls.every(([, options]) => options.duration === 0)).toBe(
        true
      );
      expect(document.activeElement).toBe(document.body);
      await clock.frame(882);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ungroup A' }));
    });

    it('keeps the ungrouped members’ bounding center fixed while their layout and children move', async () => {
      const clock = animationClock();
      mocks.reduceMotion = true;
      const { rerender } = await renderMotionGraph();
      mockVisibleCardBounds();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Group A2' }));
      });
      const aggregate = mocks.nodes.find(node => node.type === 'aggregated');
      const viewport = { ...mocks.viewport };
      const anchorScreen = {
        x: screenPosition(aggregate.id).x + (NODE_WIDTH * viewport.zoom) / 2,
        y: screenPosition(aggregate.id).y + (AGGREGATED_NODE_HEIGHT * viewport.zoom) / 2,
      };
      function expectFixedCenter() {
        const first = screenPosition('A1');
        const second = screenPosition('A2');
        expect((first.x + second.x + NODE_WIDTH * viewport.zoom) / 2).toBe(anchorScreen.x);
        expect((first.y + second.y + cardHeight * viewport.zoom) / 2).toBeCloseTo(
          anchorScreen.y,
          8
        );
        expect(mocks.viewport.zoom).toBe(viewport.zoom);
      }
      mocks.setViewport.mockClear();
      const origin = {
        x: aggregate.position.x,
        y: aggregate.position.y + (AGGREGATED_NODE_HEIGHT - cardHeight) / 2,
      };
      const source = new Map(positions().map(node => [node.id, node.position]));
      mocks.reduceMotion = false;
      rerender(<CrossplaneMap />);
      mockVisibleCardBounds();
      let target: any;
      mocks.layout.mockImplementationOnce(async input => {
        target = positionedLayout(input, 900);
        return target;
      });
      const button = screen.getByRole('button', { name: 'Ungroup A' });
      act(() => button.focus());
      await act(async () => {
        fireEvent.click(button);
      });
      expect(node(aggregate.id)).toBeUndefined();
      expect(node('A1').position).toEqual(origin);
      expect(node('A2').position).toEqual(origin);
      expectFixedCenter();
      for (const id of ['P', 'B1', 'B2']) expect(node(id).position).toEqual(source.get(id));
      expect(mocks.nodes.every(node => !node.hidden && !node.className?.includes('fading'))).toBe(
        true
      );
      expect(mocks.fitView).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(document.body);

      await clock.frame(0);
      await clock.frame(250);
      for (const id of ['A1', 'A2']) {
        const end = target.children.find((node: any) => node.id === id);
        expect(node(id).position.x).toBe((origin.x + end.x) / 2);
        expect(node(id).position.y).toBeCloseTo((origin.y + end.y) / 2, 8);
      }
      expectFixedCenter();
      expect(mocks.fitView).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(document.body);
      await clock.frame(500);
      expect(positions()).toEqual(layoutPositions(target));
      expect(mocks.fitView).toHaveBeenCalledTimes(1);
      expectFixedCenter();
      await clock.frame(516);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Group A1' }));
    });

    it('applies grouping and ungrouping immediately when reduced motion is enabled', async () => {
      animationClock();
      mocks.reduceMotion = true;
      await renderMotionGraph();
      const original = positions();
      const anchorScreen = screenPosition('A2');
      let target: any;
      mocks.layout.mockImplementationOnce(async input => {
        target = positionedLayout(input, 900);
        return target;
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Group A2' }));
      });
      expect(positions()).toEqual(layoutPositions(target));
      expect(mocks.nodes.find(node => node.type === 'aggregated').data.memberCount).toBe(2);
      const aggregate = mocks.nodes.find(node => node.type === 'aggregated');
      expect(screenPosition(aggregate.id)).toEqual(anchorScreen);
      expect(mocks.viewport.zoom).toBe(1);
      expect(mocks.fitView).toHaveBeenCalledTimes(1);
      const groupCenter = {
        x: screenPosition(aggregate.id).x + NODE_WIDTH / 2,
        y: screenPosition(aggregate.id).y + AGGREGATED_NODE_HEIGHT / 2,
      };
      mocks.setViewport.mockClear();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Ungroup A' }));
      });
      expect(positions()).toEqual(original);
      expect(mocks.fitView).toHaveBeenCalledTimes(1);
      expect((screenPosition('A1').x + screenPosition('A2').x + NODE_WIDTH) / 2).toBe(
        groupCenter.x
      );
      expect(
        (screenPosition('A1').y + screenPosition('A2').y + RESOURCE_NODE_LAYOUT_HEIGHT) / 2
      ).toBeCloseTo(groupCenter.y, 8);
      expect(mocks.viewport.zoom).toBe(1);
    });

    it.each([
      { operation: 'group', action: 'early pan' },
      { operation: 'group', action: 'pan' },
      { operation: 'group', action: 'Zoom in' },
      { operation: 'group', action: 'Zoom out' },
      { operation: 'ungroup', action: 'pan' },
      { operation: 'ungroup', action: 'Zoom in' },
    ])(
      'stops $operation camera tracking after $action while completing the node motion',
      async ({ operation, action }) => {
        const clock = animationClock();
        const { rerender } = await renderMotionGraph();
        if (operation === 'ungroup') {
          mocks.reduceMotion = true;
          rerender(<CrossplaneMap />);
          await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Group all' })));
          mocks.reduceMotion = false;
          rerender(<CrossplaneMap />);
        }
        let target: any;
        mocks.layout.mockImplementationOnce(async input => {
          target = positionedLayout(input, 900);
          return target;
        });
        const button = screen.getByRole('button', {
          name: operation === 'group' ? 'Group A2' : 'Ungroup A',
        });
        act(() => button.focus());
        await act(async () => {
          fireEvent.click(button);
        });
        await clock.frame(0);
        await clock.frame(175);
        if (action !== 'early pan') {
          if (operation === 'group') {
            await clock.frame(350);
            await clock.frame(366);
            await clock.frame(616);
          }
          expect(mocks.setViewport).toHaveBeenCalled();
        }
        mocks.setViewport.mockClear();
        if (action.endsWith('pan')) {
          act(() => {
            mocks.viewport = { x: 240, y: -60, zoom: 0.7 };
            mocks.onMoveStart(new Event('pointermove'));
          });
        } else fireEvent.click(screen.getByRole('button', { name: action }));
        const viewport = { ...mocks.viewport };
        if (action === 'early pan') {
          await clock.frame(350);
          await clock.frame(366);
        }
        await clock.frame(operation === 'group' ? 866 : 500);
        await clock.frame(operation === 'group' ? 882 : 516);
        expect(positions()).toEqual(layoutPositions(target));
        expect(mocks.fitView).toHaveBeenCalledTimes(1);
        expect(mocks.setViewport).not.toHaveBeenCalled();
        expect(mocks.viewport).toEqual(viewport);
        expect(document.activeElement).toBe(document.body);
      }
    );

    it('releases card interaction when an interrupting filter layout fails', async () => {
      const clock = animationClock();
      await renderMotionGraph();
      mocks.layout.mockImplementationOnce(async input => positionedLayout(input, 900));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Group A2' })));
      await clock.frame(0);
      await clock.frame(175);
      expect(mocks.nodes.every(node => node.domAttributes.inert === '')).toBe(true);
      const previousPositions = positions();
      const previousEdgeIds = mocks.edges.map(edge => edge.id);
      const pending = delayedLayouts();
      selectStatus('Healthy');
      await waitFor(() => expect(pending).toHaveLength(1));
      await act(async () => pending[0].fail());
      expect(screen.getByRole('alert').textContent).toContain('Could not arrange the map');
      mocks.setViewport.mockClear();
      const viewport = { ...mocks.viewport };
      await clock.frame(2000);
      expect(mocks.nodes.every(node => node.domAttributes.inert === undefined)).toBe(true);
      expect(positions()).toEqual(previousPositions);
      expect(mocks.edges.map(edge => edge.id)).toEqual(previousEdgeIds);
      expect(mocks.setViewport).not.toHaveBeenCalled();
      expect(mocks.viewport).toEqual(viewport);
      expect(mocks.fitView).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'Open P' }));
      expect(mocks.openDetails).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'P' }));
      act(() => node('P').data.onToggleCollapse('P'));
      expect(node('A1').domAttributes).toMatchObject({ 'aria-hidden': true, inert: '' });
      expect(node('A2').domAttributes).toMatchObject({ 'aria-hidden': true, inert: '' });
      act(() => node('P').data.onToggleCollapse('P'));
      expect(node('A1').domAttributes.inert).toBeUndefined();
      expect(node('A2').domAttributes.inert).toBeUndefined();
      expect(pending).toHaveLength(1);
    });

    it('starts a superseding global action from the current motion frame', async () => {
      const clock = animationClock();
      await renderMotionGraph();
      const original = positions();
      mocks.layout.mockImplementationOnce(async input => positionedLayout(input, 900));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Group A2' }));
      });
      await clock.frame(0);
      await clock.frame(175);
      const intermediate = positions();
      expect(intermediate).not.toEqual(original);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Ungroup all' }));
      });
      expect(positions()).toEqual(intermediate);
      await clock.frame(200);
      await clock.frame(450);
      expect(mocks.nodes.every(node => node.type === 'resource')).toBe(true);
      expect(node('A1').position).toEqual({
        x: (intermediate[1].position.x + original[1].position.x) / 2,
        y: (intermediate[1].position.y + original[1].position.y) / 2,
      });
      expect(mocks.fitView).toHaveBeenCalledTimes(1);
      await clock.frame(700);
      expect(positions()).toEqual(original);
      expect(mocks.fitView).toHaveBeenCalledTimes(1);
      expect(mocks.setViewport).not.toHaveBeenCalled();
      await clock.frame(1200);
      expect(positions()).toEqual(original);
    });

    it('cancels obsolete motion frames when live resources disappear', async () => {
      const clock = animationClock();
      const { rerender, graph } = await renderMotionGraph();
      mocks.layout.mockImplementationOnce(async input => positionedLayout(input, 900));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Group A2' }));
      });
      await clock.frame(0);
      await clock.frame(175);
      const pending = delayedLayouts();
      const removed = new Set(['A1', 'B1']);
      await act(async () => {
        mocks.source.current = {
          nodes: graph.nodes.filter(node => !removed.has(node.id)),
          edges: graph.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)),
        };
        rerender(<CrossplaneMap />);
      });
      expect(pending).toHaveLength(1);
      expect(mocks.nodes.map(node => node.id)).toEqual(['P', 'A2', 'B2']);
      expect(
        mocks.edges.every(edge => !removed.has(edge.source) && !removed.has(edge.target))
      ).toBe(true);
      await clock.frame(350);
      expect(mocks.nodes.map(node => node.id)).toEqual(['P', 'A2', 'B2']);
      await act(async () => pending[0].finish(1800));
      const latest = layoutPositions(positionedLayout(pending[0].input, 1800));
      expect(positions()).toEqual(latest);
      await clock.frame(1200);
      expect(positions()).toEqual(latest);
    });

    it('keeps every member represented when a live reference does not change the grouped layout', async () => {
      const clock = animationClock();
      const { rerender, graph } = await renderMotionGraph();
      mocks.layout.mockImplementationOnce(async input => positionedLayout(input, 900));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Group A2' }));
      });
      await clock.frame(0);
      await clock.frame(175);
      const expectCompleteGraph = () => {
        expect(
          mocks.nodes
            .flatMap(node =>
              node.type === 'aggregated' && node.data.kind === 'A' && node.data.memberCount === 2
                ? ['A1', 'A2']
                : [node.id]
            )
            .sort()
        ).toEqual(['A1', 'A2', 'B1', 'B2', 'P']);
      };
      expectCompleteGraph();
      await act(async () => {
        mocks.source.current = {
          ...graph,
          edges: [
            ...graph.edges,
            { id: 'internal-reference', source: 'A1', target: 'A2', aux: true },
          ],
        };
        rerender(<CrossplaneMap />);
      });
      expectCompleteGraph();
      for (const time of [350, 700, 716, 1216, 1232]) {
        await clock.frame(time);
        expectCompleteGraph();
      }
      expect(visibleNames()).toEqual(['(A)', 'B1', 'B2', 'P']);
      expect(mocks.edges.every(edge => edge.id !== 'internal-reference')).toBe(true);
      const settled = positions();
      await clock.frame(2000);
      expect(positions()).toEqual(settled);

      mocks.reduceMotion = true;
      rerender(<CrossplaneMap />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Ungroup A' }));
      });
      expect(mocks.edges.find(edge => edge.id === 'internal-reference')).toMatchObject({
        source: 'A1',
        target: 'A2',
      });
    });

    it.each([
      { phase: 'gather', filter: 'Healthy' },
      { phase: 'layout', filter: 'Healthy' },
      { phase: 'layout', filter: 'None' },
      { phase: 'layout', filter: 'All' },
    ])(
      'freezes the camera when $filter filtering interrupts the group $phase phase',
      async ({ phase, filter }) => {
        const clock = animationClock();
        const { rerender, graph } = await renderMotionGraph();
        mocks.source.current = {
          ...graph,
          nodes: graph.nodes.map(node =>
            node.id === (filter === 'All' ? 'B2' : 'A2') ? { ...node, status: 'error' } : node
          ),
        };
        rerender(<CrossplaneMap />);
        if (filter === 'All') {
          selectStatus('Healthy');
          await waitFor(() => expect(mocks.nodes).toHaveLength(4));
        }
        mocks.viewport = { x: 120, y: 80, zoom: 0.5 };
        mocks.layout.mockImplementationOnce(async input => positionedLayout(input, 900));
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Group A1' })));
        await clock.frame(0);
        await clock.frame(175);
        if (phase === 'layout') {
          await clock.frame(350);
          await clock.frame(366);
          await clock.frame(616);
          expect(mocks.setViewport).toHaveBeenCalled();
        }
        const viewport = { ...mocks.viewport };
        mocks.fitView.mockClear();
        mocks.setViewport.mockClear();
        mocks.layout.mockImplementationOnce(async input => positionedLayout(input, 1800));
        if (filter === 'None') selectOption('Status', 'All');
        else selectStatus(filter as 'Healthy' | 'All');
        await act(async () => {});
        expect(mocks.viewport).toEqual(viewport);
        for (const time of [700, 950, 1200, 1400, 2000]) {
          await clock.frame(time);
          expect(mocks.fitView).not.toHaveBeenCalled();
          expect(mocks.setViewport).not.toHaveBeenCalled();
          expect(mocks.viewport).toEqual(viewport);
        }
        expect(visibleNames()).toEqual(
          filter === 'None'
            ? []
            : filter === 'All'
            ? ['(A)', 'B1', 'B2', 'P']
            : ['A1', 'B1', 'B2', 'P']
        );
      }
    );

    it('continues from the current ungroup frame without moving the camera when matching filters change', async () => {
      const clock = animationClock();
      mocks.reduceMotion = true;
      const { rerender, graph } = await renderMotionGraph();
      mocks.source.current = {
        ...graph,
        nodes: graph.nodes.map(node => (node.id === 'A2' ? { ...node, status: 'error' } : node)),
      };
      rerender(<CrossplaneMap />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Group A1' }));
      });
      expect(visibleNames()).toEqual(['(A)', 'B1', 'B2', 'P']);
      mocks.reduceMotion = false;
      rerender(<CrossplaneMap />);
      mocks.layout.mockImplementationOnce(async input => positionedLayout(input, 900));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Ungroup A' }));
      });
      expect(
        screen.getByRole('combobox', { name: 'Status' }).getAttribute('aria-disabled')
      ).not.toBe('true');
      await clock.frame(0);
      await clock.frame(250);
      const memberPosition = { ...node('A1').position };
      const parentPosition = { ...node('P').position };
      const viewport = { ...mocks.viewport };
      mocks.fitView.mockClear();
      mocks.setViewport.mockClear();
      let target: any;
      mocks.layout.mockImplementationOnce(async input => {
        target = positionedLayout(input, 1800);
        return target;
      });
      selectStatus('Healthy');
      await act(async () => {});
      expect(node('A1').position).toEqual(memberPosition);
      expect(node('P').position).toEqual(parentPosition);
      expect(mocks.viewport).toEqual(viewport);
      await clock.frame(300);
      await clock.frame(550);
      const memberTarget = target.children.find((node: any) => node.id === 'A1');
      expect(node('A1').position).toEqual({
        x: (memberPosition.x + memberTarget.x) / 2,
        y: (memberPosition.y + memberTarget.y) / 2,
      });
      expect(mocks.viewport).toEqual(viewport);
      await clock.frame(800);
      // B2 becomes a separate component after A2 is filtered out, closing its vertical gap.
      expect(positions()).toEqual(
        layoutPositions(target).map(node =>
          node.id === 'B2'
            ? {
                ...node,
                position: {
                  ...node.position,
                  y: target.children.find((node: any) => node.id === 'P').y,
                },
              }
            : node
        )
      );
      expect(visibleNames()).toEqual(['A1', 'B1', 'B2', 'P']);
      const settled = positions();
      await clock.frame(1300);
      expect(positions()).toEqual(settled);
      expect(mocks.fitView).not.toHaveBeenCalled();
      expect(mocks.setViewport).not.toHaveBeenCalled();
      expect(mocks.viewport).toEqual(viewport);
    });
  });

  it('discards an unfinished grouped layout when all groups are removed', async () => {
    mocks.source.current = groupingGraph();
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(7));
    let finishGrouping!: (result: any) => void;
    mocks.layout.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishGrouping = resolve;
        })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Group all' }));
    await waitFor(() => expect(finishGrouping).toBeDefined());
    const groupedInput = mocks.layout.mock.calls.at(-1)![0];
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup all' }));
    await waitFor(() => expect(visibleNames()).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D2']));
    await act(async () => finishGrouping(groupedInput));
    expect(visibleNames()).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D2']);
    expect(mocks.edges).toHaveLength(5);
  });
});
