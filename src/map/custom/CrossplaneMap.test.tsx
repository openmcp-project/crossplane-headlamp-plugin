import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CrossplaneMap from './CrossplaneMap';

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
vi.mock('elkjs/lib/elk.bundled.js', () => ({
  default: class {
    layout = mocks.layout;
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
    ReactFlow: ({ nodes, edges, children, onNodesChange, onMoveStart }: any) => {
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
          {nodes.map((node: any) => (
            <button
              className="react-flow__node"
              key={node.id}
              type="button"
              onClick={node.data.onOpenDetails}
            >
              Open {node.data.name}
            </button>
          ))}
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
    expect(screen.getByTestId('nodes').textContent).toBe('named,missing');
    expect(mocks.nodes.find(node => node.id === 'missing').className).toContain('dimmed');
    expect(mocks.nodes.find(node => node.id === 'named').className ?? '').not.toContain('dimmed');
    expect(filter.textContent).toContain(value);

    fireEvent.mouseDown(filter);
    fireEvent.click(screen.getByRole('option', { name: value }));
    fireEvent.click(screen.getByRole('option', { name: 'Not set' }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.getByTestId('nodes').textContent).toBe('named,missing');
    expect(mocks.nodes.find(node => node.id === 'named').className).toContain('dimmed');
    expect(mocks.nodes.find(node => node.id === 'missing').className ?? '').not.toContain('dimmed');
    expect(filter.textContent).toContain('Not set');

    fireEvent.mouseDown(filter);
    fireEvent.click(screen.getByRole('option', { name: 'All' }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('nodes').textContent).toBe('named,missing'));
    expect(filter.textContent).toContain('All');
    expect(mocks.nodes.every(node => !node.className?.includes('dimmed'))).toBe(true);
    expect(mocks.layout).toHaveBeenCalledTimes(1);
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
      data: { status: 'error', providerName: 'new-provider' },
    });
    expect(mocks.nodes[0].data.kubeObject.metadata.labels).toEqual({ team: 'new-team' });
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
  };
}

function selectOption(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(screen.getByRole('option', { name: option }));
  if (screen.queryByRole('listbox')) {
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  }
}

function selectStatus(status: 'Ready' | 'Not Ready' | 'All') {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Status' }));
  if (status !== 'All') {
    const other = screen.getByRole('option', {
      name: status === 'Ready' ? 'Not Ready' : 'Ready',
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

// Rendered as a MUI Switch, which keeps the checkbox ARIA role.
function matchingCheckbox() {
  return screen.getByRole('checkbox', { name: 'Hide non-matching' }) as HTMLInputElement;
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
  return result;
}

async function renderBlueFilter() {
  const result = await renderFilteringGraph();
  selectTeam();
  return result;
}

describe('Crossplane map context and matching views', () => {
  it('toggles each status independently and keeps all four selections in the graph context', async () => {
    await renderFilteringGraph();
    const fullPositions = positions();
    const filter = screen.getByRole('combobox', { name: 'Status' });
    expect(filter.textContent).toBe('All');

    fireEvent.mouseDown(filter);
    const all = screen.getByRole('option', { name: 'All' });
    const ready = screen.getByRole('option', { name: 'Ready' });
    const notReady = screen.getByRole('option', { name: 'Not Ready' });
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
    expect(
      [all, ready, notReady].map(option => option.querySelector<HTMLInputElement>('input')?.checked)
    ).toEqual([true, true, true]);

    fireEvent.click(ready);
    expect(filter.textContent).toBe('Not Ready');
    expect(all.querySelector('input')?.getAttribute('data-indeterminate')).toBe('true');
    expect(
      mocks.nodes.filter(node => !node.className?.includes('dimmed')).map(node => node.id)
    ).toEqual(['child']);
    expect(screen.getByText('1 of 4 resources match filters')).toBeTruthy();

    fireEvent.click(notReady);
    expect(filter.textContent).toBe('None');
    expect(
      [all, ready, notReady].map(option => option.querySelector<HTMLInputElement>('input')?.checked)
    ).toEqual([false, false, false]);
    expect(all.querySelector('input')?.getAttribute('data-indeterminate')).toBe('false');
    expect(mocks.nodes.every(node => node.className?.includes('dimmed'))).toBe(true);
    expect(screen.getByText('0 of 4 resources match filters')).toBeTruthy();

    fireEvent.click(ready);
    expect(filter.textContent).toBe('Ready');
    expect(node('child').className).toContain('dimmed');
    expect(screen.getByText('3 of 4 resources match filters')).toBeTruthy();

    fireEvent.click(notReady);
    expect(filter.textContent).toBe('All');
    expect(all.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
    expect(mocks.nodes.every(node => !node.className?.includes('dimmed'))).toBe(true);
    expect(screen.queryByText(/resources match filters/)).toBeNull();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(positions()).toEqual(fullPositions);
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
  });

  it('keeps the status checkboxes out of the pointer focus path so keyboard navigation survives a click', async () => {
    await renderFilteringGraph();
    const filter = screen.getByRole('combobox', { name: 'Status' });

    fireEvent.mouseDown(filter);
    const ready = screen.getByRole('option', { name: 'Ready' });

    // The checkbox is presentational: a mouse click must reach the owning
    // option, never the aria-hidden <input>. tabIndex=-1 alone does not stop
    // pointer focus, so the input (and its MUI wrapper) must not take pointer
    // events — otherwise focus leaves the listbox option and the menu's
    // arrow-key handler jumps back to the first item (jsdom has no native
    // click-to-focus, so we assert the structural cause rather than focus).
    const input = ready.querySelector<HTMLInputElement>('input')!;
    expect(getComputedStyle(input.closest('.MuiCheckbox-root')!).pointerEvents).toBe('none');

    // Clicking the box still toggles the status, because the option handles it.
    fireEvent.click(input);
    expect(filter.textContent).toBe('Not Ready');
  });

  it('clears and restores all statuses while keeping an empty matching view usable', async () => {
    await renderFilteringGraph();
    selectOption('Status', 'All');
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toBe('None');
    expect(screen.getByText('0 of 4 resources match filters')).toBeTruthy();
    expect(mocks.nodes.every(node => node.className?.includes('dimmed'))).toBe(true);

    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(0));
    expect(screen.getByText('No resources match the selected filters.')).toBeTruthy();
    expect(matchingCheckbox().checked).toBe(true);
    expect(mocks.fitView).not.toHaveBeenCalled();

    selectOption('Status', 'All');
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toBe('All');
    expect(matchingCheckbox().checked).toBe(true);
    expect(screen.queryByText('No resources match the selected filters.')).toBeNull();
    expect(mocks.nodes.every(node => !node.className?.includes('dimmed'))).toBe(true);
  });

  it('dims non-matches without changing geometry, layout or viewport and clears dimming with All', async () => {
    await renderFilteringGraph();
    const fullPositions = positions();
    selectTeam();

    expect(screen.getByTestId('nodes').textContent).toBe('parent,child,grandchild,leaf');
    expect(node('child').className).toContain('dimmed');
    expect(node('child').domAttributes).toMatchObject({ 'aria-hidden': true, inert: '' });
    expect(node('parent').domAttributes['aria-hidden']).toBeUndefined();
    expect(node('parent').domAttributes.inert).toBeUndefined();
    expect(positions()).toEqual(fullPositions);
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();

    selectOption('Common Label', 'All');
    expect(mocks.nodes.every(node => !node.className?.includes('dimmed'))).toBe(true);
    expect(positions()).toEqual(fullPositions);
    expect(screen.queryByRole('checkbox', { name: 'Hide non-matching' })).toBeNull();
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.fitView).not.toHaveBeenCalled();
  });

  it('combines category and status filters and counts exclusions independently of collapse', async () => {
    await renderBlueFilter();
    expect(screen.getByText('3 of 4 resources match filters')).toBeTruthy();
    act(() => node('parent').data.onToggleCollapse('parent'));
    expect(screen.getByTestId('nodes').textContent).toBe('parent');
    expect(screen.getByText('3 of 4 resources match filters')).toBeTruthy();

    selectStatus('Not Ready');
    expect(matchingCheckbox().checked).toBe(false);
    expect(screen.getByText('0 of 4 resources match filters')).toBeTruthy();
    expect(screen.queryByText('No resources match the selected filters.')).toBeNull();
    expect(mocks.nodes.every(node => node.className?.includes('dimmed'))).toBe(true);
    expect(screen.getByTestId('nodes').textContent).toBe('parent,child,grandchild,leaf');
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.fitView).not.toHaveBeenCalled();
  });

  it('uses singular wording in the match count when the graph holds one resource', async () => {
    mocks.layout.mockImplementation(async input => positionedLayout(input));
    mocks.source.current = {
      nodes: [filteringGraph().nodes[0]],
      edges: [],
    };
    render(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(1));

    selectStatus('Ready');
    expect(screen.getByText('1 of 1 resource matches filters')).toBeTruthy();

    selectStatus('Not Ready');
    expect(screen.getByText('0 of 1 resource matches filters')).toBeTruthy();
  });

  it('hides the toggle when a filter is active but excludes nothing', async () => {
    const { rerender } = await renderFilteringGraph();
    expect(screen.queryByRole('checkbox', { name: 'Hide non-matching' })).toBeNull();
    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({ ...node, status: 'success' })),
    };
    rerender(<CrossplaneMap />);
    selectStatus('Ready');
    expect(screen.queryByRole('checkbox', { name: 'Hide non-matching' })).toBeNull();
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.fitView).not.toHaveBeenCalled();
  });

  it('compacts matching nodes and valid edges, including matches hidden by structural collapse', async () => {
    await renderBlueFilter();
    act(() => node('parent').data.onToggleCollapse('parent'));
    const pending = delayedLayouts();
    fireEvent.click(matchingCheckbox());
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
    const geometryAtFit: string[][] = [];
    mocks.fitView.mockImplementation(async () => {
      geometryAtFit.push(mocks.nodes.map(node => node.id));
      return true;
    });
    await act(async () => pending[0].finish(50));
    expect(mocks.nodes.map(node => node.id)).toEqual(['parent', 'grandchild', 'leaf']);
    expect(screen.getByTestId('nodes').textContent).toBe('parent');
    expect(node('parent').data.childCount).toBe(1);
    expect(node('parent').data.collapsed).toBe(true);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
    expect(mocks.fitView.mock.calls[0][0].nodes.map((node: any) => node.id)).toEqual(['parent']);
    expect(geometryAtFit).toEqual([['parent', 'grandchild', 'leaf']]);

    act(() => node('parent').data.onToggleCollapse('parent'));
    expect(screen.getByTestId('nodes').textContent).toBe('parent,grandchild,leaf');
    expect(node('grandchild').position).toEqual({ x: 410, y: 270 });
    expect(mocks.layout).toHaveBeenCalledTimes(2);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
  });

  it('restores the exact full positions and captured viewport without another layout', async () => {
    await renderBlueFilter();
    const fullPositions = positions();
    const contextViewport = { x: -137, y: 92, zoom: 0.63 };
    mocks.viewport = contextViewport;
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    mocks.viewport = { x: -900, y: -700, zoom: 1.8 };
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.setViewport).toHaveBeenCalledTimes(1));
    expect(positions()).toEqual(fullPositions);
    expect(mocks.setViewport.mock.calls[0][0]).toEqual(contextViewport);
    expect(mocks.layout).toHaveBeenCalledTimes(2);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
  });

  it.each(['category mode', 'category selection', 'status', 'label key'])(
    'keeps matching mode checked and lays out the new matches after changing %s',
    async change => {
      const { rerender } = await renderBlueFilter();
      mocks.viewport = { x: 77, y: -42, zoom: 0.7 };
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
      fireEvent.click(matchingCheckbox());
      await waitFor(() => expect(mocks.nodes).toHaveLength(3));
      await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
      mocks.layout.mockImplementation(async input => positionedLayout(input, 100));
      if (change === 'category mode') selectOption('Categorize by', 'Flux');
      if (change === 'category selection') selectOption('Common Label', 'red');
      if (change === 'status') selectStatus('Not Ready');
      if (change === 'label key') selectOption('Label', 'env');
      expect(matchingCheckbox().checked).toBe(true);
      await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(2));
      expect(mocks.layout).toHaveBeenCalledTimes(3);
      const expectedIds =
        change === 'status' ? ['leaf'] : ['parent', 'child', 'grandchild', 'leaf'];
      expect(mocks.layout.mock.calls[2][0].children.map((resource: any) => resource.id)).toEqual(
        expectedIds
      );
      expect(mocks.nodes.map(resource => resource.id)).toEqual(expectedIds);
      expect(node(expectedIds[0]).position).toEqual({ x: 100, y: 100 });
      expect(mocks.setViewport).not.toHaveBeenCalled();
    }
  );

  it.each(['topology', 'dimensions', 'edge priority'])(
    'recomputes and fits the current full graph when cached %s became invalid',
    async change => {
      const { rerender } = await renderBlueFilter();
      fireEvent.click(matchingCheckbox());
      await waitFor(() => expect(mocks.nodes).toHaveLength(3));
      await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
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
      expect(mocks.layout).toHaveBeenCalledTimes(2);
      fireEvent.click(matchingCheckbox());
      await waitFor(() => expect(mocks.nodes).toHaveLength(4));
      expect(mocks.layout).toHaveBeenCalledTimes(3);
      expect(mocks.fitView).toHaveBeenCalledTimes(2);
      expect(mocks.setViewport).not.toHaveBeenCalled();
    }
  );

  it('preserves matching mode on live membership changes and never fits subsequent live layouts', async () => {
    const { rerender } = await renderBlueFilter();
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    mocks.source.current = {
      ...mocks.source.current,
      nodes: mocks.source.current.nodes.map((node: any) => ({
        ...node,
        kubeObject: {
          ...node.kubeObject,
          metadata: { ...node.kubeObject.metadata, labels: { team: 'blue' } },
        },
      })),
    };
    rerender(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    expect(matchingCheckbox().checked).toBe(true);
    expect(screen.getByText('Hide non-matching')).toBeTruthy();
    expect(mocks.layout).toHaveBeenCalledTimes(3);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.setViewport).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('checkbox', { name: 'Hide non-matching' })).toBeNull();
    expect(mocks.layout).toHaveBeenCalledTimes(3);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
  });

  it('preserves matching mode on live status changes and updates membership without fitting', async () => {
    const { rerender } = await renderFilteringGraph();
    selectStatus('Ready');
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({
        ...node,
        status: node.id === 'parent' ? 'error' : node.status,
      })),
    };
    rerender(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes.map(node => node.id)).toEqual(['grandchild', 'leaf']));
    expect(matchingCheckbox().checked).toBe(true);
    expect(mocks.layout).toHaveBeenCalledTimes(3);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
  });

  it('recalculates the new matching subset when a previously unrestricted checked view is filtered', async () => {
    const { rerender } = await renderBlueFilter();
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    const graph = filteringGraph();
    mocks.source.current = {
      ...graph,
      nodes: graph.nodes.map(resource => ({
        ...resource,
        kubeObject: {
          ...resource.kubeObject,
          metadata: { ...resource.kubeObject.metadata, labels: { team: 'blue' } },
        },
      })),
    };
    rerender(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    expect(matchingCheckbox().checked).toBe(true);
    expect(screen.getByText('Hide non-matching')).toBeTruthy();
    expect(mocks.layout).toHaveBeenCalledTimes(3);
    mocks.layout.mockImplementation(async input => positionedLayout(input, 150));

    selectStatus('Ready');
    expect(matchingCheckbox().checked).toBe(true);
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(2));
    expect(mocks.layout).toHaveBeenCalledTimes(4);
    expect(mocks.nodes.map(resource => resource.id)).toEqual(['parent', 'grandchild', 'leaf']);
    expect(node('parent').position).toEqual({ x: 150, y: 150 });
    expect(node('child')).toBeUndefined();
  });

  it.each(['All', 'None'])(
    'keeps a checked checkbox visible after selecting %s and applies the next filter in matching mode',
    async option => {
      await renderBlueFilter();
      fireEvent.click(matchingCheckbox());
      await waitFor(() => expect(mocks.nodes).toHaveLength(3));
      if (option === 'All') selectOption('Common Label', 'All');
      else selectOption('Categorize by', 'None');
      await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(2));
      expect(mocks.nodes).toHaveLength(4);
      expect(matchingCheckbox().checked).toBe(true);

      selectStatus('Ready');
      await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(3));
      expect(mocks.nodes.map(resource => resource.id)).toEqual(['parent', 'grandchild', 'leaf']);
      expect(matchingCheckbox().checked).toBe(true);
      expect(mocks.layout).toHaveBeenCalledTimes(4);
      fireEvent.click(matchingCheckbox());
      await waitFor(() => expect(mocks.nodes).toHaveLength(4));
      expect(matchingCheckbox().checked).toBe(false);
    }
  );

  it('keeps matching mode through an empty filter result and fits the next non-empty result', async () => {
    await renderBlueFilter();
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    selectStatus('Not Ready');
    expect(matchingCheckbox().checked).toBe(true);
    await waitFor(() => expect(mocks.nodes).toHaveLength(0));
    expect(screen.getByText('No resources match the selected filters.')).toBeTruthy();
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
    expect(mocks.layout).toHaveBeenCalledTimes(2);

    selectStatus('Ready');
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(2));
    expect(mocks.nodes.map(resource => resource.id)).toEqual(['parent', 'grandchild', 'leaf']);
    expect(matchingCheckbox().checked).toBe(true);
    expect(screen.queryByText('No resources match the selected filters.')).toBeNull();
  });

  it('relayouts matching mode when a data-driven label-key fallback invalidates the filter', async () => {
    const { rerender } = await renderBlueFilter();
    mocks.viewport = { x: 11, y: 22, zoom: 0.8 };
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
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
    expect(matchingCheckbox().checked).toBe(true);
    expect(mocks.setViewport).not.toHaveBeenCalled();
    expect(mocks.fitView).toHaveBeenCalledTimes(2);
    expect(mocks.layout).toHaveBeenCalledTimes(3);
  });

  it('applies identical dimming and exclusion rules to node and edge accessibility while layout is pending', async () => {
    await renderBlueFilter();
    const pending = delayedLayouts();
    fireEvent.click(matchingCheckbox());
    expect(pending).toHaveLength(1);
    expect(node('child')).toMatchObject({
      hidden: false,
      domAttributes: { 'aria-hidden': true, inert: '' },
    });
    for (const id of ['parent-child', 'child-grandchild']) {
      const edge = mocks.edges.find(edge => edge.id === id);
      expect(edge.className).toContain('dimmed');
      expect(edge.domAttributes['aria-hidden']).toBe(true);
      expect(edge.focusable).toBe(false);
      expect(edge.selectable).toBe(false);
    }
    expect(
      mocks.edges.find(edge => edge.id === 'grandchild-leaf').domAttributes['aria-hidden']
    ).toBeUndefined();
    act(() => node('parent').data.onToggleCollapse('parent'));
    expect(node('child').domAttributes['aria-hidden']).toBe(true);
    expect(node('grandchild').domAttributes).toMatchObject({ 'aria-hidden': true, inert: '' });
    expect(mocks.edges.every(edge => edge.domAttributes['aria-hidden'])).toBe(true);
    await act(async () => pending[0].finish());
  });

  it('does not relayout when reduced motion changes and uses zero viewport duration', async () => {
    const { rerender } = await renderBlueFilter();
    mocks.reduceMotion = false;
    rerender(<CrossplaneMap />);
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    mocks.reduceMotion = true;
    rerender(<CrossplaneMap />);
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    expect(mocks.fitView.mock.calls[0][0].duration).toBe(0);
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.setViewport).toHaveBeenCalledTimes(1));
    expect(mocks.setViewport.mock.calls[0][1].duration).toBe(0);
  });
});

describe('Crossplane map collapse with filtering', () => {
  it('hides excluded children and follows excluded intermediate nodes without losing expand controls', async () => {
    await renderBlueFilter();
    act(() => node('parent').data.onToggleCollapse('parent'));
    expect(screen.getByTestId('nodes').textContent).toBe('parent');
    expect(node('parent').data).toMatchObject({ childCount: 1, collapsed: true });
    expect(node('child').hidden).toBe(true);
    expect(node('grandchild').hidden).toBe(true);
    expect(node('leaf').hidden).toBe(true);
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    act(() => node('parent').data.onToggleCollapse('parent'));
    expect(screen.getByTestId('nodes').textContent).toBe('parent,child,grandchild,leaf');
    expect(node('child').className).toContain('dimmed');
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.fitView).not.toHaveBeenCalled();
  });

  it('ignores a non-matching stored collapse root and restores it when the filter is removed', async () => {
    await renderFilteringGraph();
    act(() => node('child').data.onToggleCollapse('child'));
    expect(screen.getByTestId('nodes').textContent).toBe('parent,child');
    selectTeam();
    expect(screen.getByTestId('nodes').textContent).toBe('parent,child,grandchild,leaf');
    expect(node('child').data.collapsed).toBe(true);
    expect(node('grandchild').domAttributes.inert).toBeUndefined();
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    expect(screen.getByTestId('nodes').textContent).toBe('parent,grandchild,leaf');
    expect(node('grandchild').data.childCount).toBe(1);
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
    expect(screen.getByTestId('nodes').textContent).toBe('parent,child,grandchild');
    expect(node('grandchild').data).toMatchObject({ collapsed: true, childCount: 1 });
    expect(node('leaf').hidden).toBe(true);
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.fitView).not.toHaveBeenCalled();
  });
});

describe('Crossplane map layout transitions', () => {
  it('keeps a pending context layout valid when a label-key fallback clears the filter', async () => {
    const { rerender } = await renderBlueFilter();
    const pending = delayedLayouts();
    const graph = filteringGraph();
    mocks.source.current = {
      ...graph,
      nodes: graph.nodes.map(resource => ({
        ...resource,
        kubeObject: {
          ...resource.kubeObject,
          metadata: { ...resource.kubeObject.metadata, namespace: 'team-a' },
        },
      })),
    };
    rerender(<CrossplaneMap />);
    expect(pending).toHaveLength(1);
    mocks.source.current = {
      ...mocks.source.current,
      nodes: mocks.source.current.nodes.map((resource: any) => ({
        ...resource,
        kubeObject: {
          ...resource.kubeObject,
          metadata: { ...resource.kubeObject.metadata, labels: { env: 'production' } },
        },
      })),
    };
    rerender(<CrossplaneMap />);
    expect(pending).toHaveLength(1);
    await act(async () => pending[0].finish(200));
    expect(mocks.nodes).toHaveLength(4);
    expect(node('parent').position).toEqual({ x: 200, y: 200 });
    expect(screen.getByRole('combobox', { name: 'Common Label' }).textContent).toBe('All');
    expect(mocks.fitView).not.toHaveBeenCalled();
  });

  it('cancels an already queued fit before restoring the context viewport', async () => {
    await renderBlueFilter();
    const contextViewport = { x: 17, y: -30, zoom: 0.6 };
    mocks.viewport = contextViewport;
    const resolved = vi.fn();
    mocks.fitView.mockImplementation(
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
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.flowState.fitViewQueued).toBe(true));
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    expect(mocks.flowState.fitViewQueued).toBe(false);
    expect(mocks.flowState.fitViewOptions).toBeUndefined();
    expect(mocks.flowState.fitViewResolver).toBeNull();
    expect(resolved).toHaveBeenCalledWith(false);
    expect(mocks.setViewport.mock.calls.at(-1)[0]).toEqual(contextViewport);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
  });

  it.each(['user pan', 'native card focus'])(
    'captures the new context viewport after %s interrupts a restore animation',
    async interruption => {
      await renderBlueFilter();
      mocks.viewport = { x: 17, y: -30, zoom: 0.6 };
      fireEvent.click(matchingCheckbox());
      await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
      mocks.setViewport.mockImplementationOnce(() => new Promise(() => {}));
      fireEvent.click(matchingCheckbox());
      await waitFor(() => expect(mocks.setViewport).toHaveBeenCalledTimes(1));
      act(() =>
        interruption === 'user pan'
          ? mocks.onMoveStart(new Event('wheel'))
          : fireEvent.focus(screen.getByRole('button', { name: 'Open parent' }))
      );
      const pannedViewport = { x: -400, y: 125, zoom: 1.2 };
      mocks.viewport = pannedViewport;
      fireEvent.click(matchingCheckbox());
      await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(2));
      fireEvent.click(matchingCheckbox());
      await waitFor(() =>
        expect(mocks.setViewport).toHaveBeenCalledTimes(interruption === 'user pan' ? 2 : 3)
      );
      expect(mocks.setViewport.mock.calls.at(-1)[0]).toEqual(pannedViewport);
    }
  );

  it.each(['Zoom in', 'Zoom out'])(
    'captures the viewport chosen with %s during a restore animation',
    async control => {
      await renderBlueFilter();
      mocks.reduceMotion = false;
      mocks.viewport = { x: 17, y: -30, zoom: 0.6 };
      fireEvent.click(matchingCheckbox());
      await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
      mocks.setViewport.mockImplementationOnce(() => new Promise(() => {}));
      fireEvent.click(matchingCheckbox());
      await waitFor(() => expect(mocks.setViewport).toHaveBeenCalledTimes(1));
      mocks.viewport = { x: -400, y: 125, zoom: 1.2 };

      fireEvent.click(screen.getByRole('button', { name: control }));
      const chosenViewport = { ...mocks.viewport };
      fireEvent.click(matchingCheckbox());
      await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(2));
      fireEvent.click(matchingCheckbox());
      await waitFor(() => expect(mocks.setViewport).toHaveBeenCalledTimes(2));
      expect(mocks.setViewport.mock.calls.at(-1)[0]).toEqual(chosenViewport);
    }
  );

  it('retains the original context baseline when a restore animation is reversed', async () => {
    await renderBlueFilter();
    const originalViewport = { x: 17, y: -30, zoom: 0.6 };
    mocks.viewport = originalViewport;
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    mocks.setViewport.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.setViewport).toHaveBeenCalledTimes(1));
    mocks.viewport = { x: -800, y: -100, zoom: 1.7 };
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(2));
    expect(mocks.setViewport.mock.calls[1][1].duration).toBe(0);
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.setViewport).toHaveBeenCalledTimes(3));
    expect(mocks.setViewport.mock.calls.at(-1)[0]).toEqual(originalViewport);
  });

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

  it('completes an empty matching transition without fitting and preserves selection and collapse', async () => {
    const { rerender } = await renderBlueFilter();
    act(() => {
      node('parent').data.onOpenDetails();
      node('parent').data.onToggleCollapse('parent');
    });
    selectStatus('Not Ready');
    expect(screen.queryByText('No resources match the selected filters.')).toBeNull();
    expect(node('parent').selected).toBe(true);
    expect(node('parent').data.collapsed).toBe(true);
    expect(screen.getByTestId('nodes').textContent).toBe('parent,child,grandchild,leaf');
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(0));
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.fitView).not.toHaveBeenCalled();

    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({ ...node, status: 'error' })),
    };
    rerender(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    expect(matchingCheckbox().checked).toBe(true);
    expect(node('parent').selected).toBe(true);
    expect(node('parent').data.collapsed).toBe(true);
    expect(screen.getByTestId('nodes').textContent).toBe('parent');
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(screen.queryByText('No resources match the selected filters.')).toBeNull();
    selectStatus('All');
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    expect(matchingCheckbox().checked).toBe(true);
    expect(mocks.nodes).toHaveLength(3);
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(4));
    expect(node('parent').selected).toBe(true);
    expect(node('parent').data.collapsed).toBe(true);
  });

  it('clears selection and collapse on actual source emptiness, including from matching view', async () => {
    const { rerender } = await renderBlueFilter();
    act(() => {
      node('parent').data.onOpenDetails();
      node('parent').data.onToggleCollapse('parent');
    });
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    mocks.source.current = { nodes: [], edges: [] };
    rerender(<CrossplaneMap />);
    expect(screen.getByText('No Crossplane resources found.')).toBeTruthy();
    expect(mocks.nodes).toHaveLength(0);
    mocks.source.current = filteringGraph();
    rerender(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes.length).toBeGreaterThan(0));
    expect(mocks.nodes.every(node => !node.selected && !node.data.collapsed)).toBe(true);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
  });

  it('cancels a delayed matching layout and its fit when the toggle is reversed', async () => {
    await renderBlueFilter();
    const fullPositions = positions();
    mocks.viewport = { x: -25, y: 30, zoom: 0.5 };
    const pending = delayedLayouts();
    fireEvent.click(matchingCheckbox());
    expect(pending).toHaveLength(1);
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.setViewport).toHaveBeenCalledTimes(1));
    expect(positions()).toEqual(fullPositions);
    await act(async () => pending[0].finish(800));
    expect(positions()).toEqual(fullPositions);
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).toHaveBeenCalledTimes(1);
  });

  it('replaces a delayed matching layout with fresh matching geometry after the filter changes', async () => {
    await renderBlueFilter();
    const fullPositions = positions();
    const pending = delayedLayouts();
    fireEvent.click(matchingCheckbox());
    selectStatus('Ready');
    expect(matchingCheckbox().checked).toBe(true);
    expect(pending).toHaveLength(2);
    expect(pending[1].input.children.map((resource: any) => resource.id)).toEqual([
      'parent',
      'grandchild',
      'leaf',
    ]);
    await act(async () => pending[0].finish(900));
    expect(positions()).toEqual(fullPositions);
    expect(mocks.fitView).not.toHaveBeenCalled();
    await act(async () => pending[1].finish(100));
    expect(mocks.nodes).toHaveLength(3);
    expect(node('parent').position).toEqual({ x: 100, y: 100 });
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
    expect(mocks.setViewport).not.toHaveBeenCalled();
  });

  it('keeps matching mode and replaces its unfinished fit when a filter changes', async () => {
    await renderBlueFilter();
    let finishOldFit!: (value: boolean) => void;
    mocks.fitView.mockImplementationOnce(() => new Promise(resolve => (finishOldFit = resolve)));
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    const pending = delayedLayouts();

    selectStatus('Ready');
    expect(matchingCheckbox().checked).toBe(true);
    expect(pending).toHaveLength(1);
    await act(async () => finishOldFit(true));
    await act(async () => pending[0].finish(100));
    expect(mocks.nodes).toHaveLength(3);
    expect(mocks.nodes.every(resource => !resource.className?.includes('dimmed'))).toBe(true);
    expect(mocks.fitView).toHaveBeenCalledTimes(2);
    expect(mocks.fitView.mock.calls[1][0].nodes.map((resource: any) => resource.id)).toEqual([
      'parent',
      'grandchild',
      'leaf',
    ]);
  });

  it('continues an unfinished fit across live layouts without letting obsolete completion consume it', async () => {
    const { rerender } = await renderBlueFilter();
    selectStatus('Ready');
    const fits: Array<(value: boolean) => void> = [];
    mocks.fitView.mockImplementation(() => new Promise(resolve => fits.push(resolve)));
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(fits).toHaveLength(1));
    const pending = delayedLayouts();
    const graph = filteringGraph();
    mocks.source.current = {
      ...graph,
      nodes: graph.nodes.map(resource => ({
        ...resource,
        status: resource.id === 'parent' ? 'error' : resource.status,
      })),
    };
    rerender(<CrossplaneMap />);
    await act(async () => pending[0].finish(100));
    expect(mocks.nodes.map(resource => resource.id)).toEqual(['grandchild', 'leaf']);
    expect(fits).toHaveLength(2);

    await act(async () => fits[0](true));
    mocks.source.current = filteringGraph();
    rerender(<CrossplaneMap />);
    await act(async () => pending[1].finish(200));
    expect(fits).toHaveLength(3);
    await act(async () => fits[2](true));

    mocks.source.current = { ...graph, edges: graph.edges.filter(edge => !edge.aux) };
    rerender(<CrossplaneMap />);
    await act(async () => pending[2].finish(300));
    expect(fits).toHaveLength(3);
    expect(matchingCheckbox().checked).toBe(true);
  });

  it('replaces an interrupted restore with a fit when live full topology changes', async () => {
    const { rerender } = await renderBlueFilter();
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    let finishRestore!: (value: boolean) => void;
    mocks.setViewport.mockImplementationOnce(
      () => new Promise(resolve => (finishRestore = resolve))
    );
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.setViewport).toHaveBeenCalledTimes(1));
    const pending = delayedLayouts();
    const fits: Array<(value: boolean) => void> = [];
    mocks.fitView.mockImplementation(() => new Promise(resolve => fits.push(resolve)));
    const graph = filteringGraph();
    mocks.source.current = {
      ...graph,
      edges: graph.edges.filter(edge => edge.id !== 'parent-child'),
    };
    rerender(<CrossplaneMap />);
    await act(async () => pending[0].finish(100));
    expect(mocks.nodes).toHaveLength(4);
    expect(fits).toHaveLength(1);
    await act(async () => finishRestore(true));

    mocks.source.current = {
      ...graph,
      edges: graph.edges.filter(edge => edge.id !== 'child-grandchild'),
    };
    rerender(<CrossplaneMap />);
    await act(async () => pending[1].finish(200));
    expect(fits).toHaveLength(2);
    await act(async () => fits[1](true));

    mocks.source.current = filteringGraph();
    rerender(<CrossplaneMap />);
    await act(async () => pending[2].finish(300));
    expect(fits).toHaveLength(2);
    expect(matchingCheckbox().checked).toBe(false);
  });

  it('transfers a pending matching fit to live replacement work, then leaves later updates alone', async () => {
    const { rerender } = await renderBlueFilter();
    const pending = delayedLayouts();
    fireEvent.click(matchingCheckbox());
    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({
        ...node,
        kubeObject: {
          ...node.kubeObject,
          metadata: {
            ...node.kubeObject.metadata,
            labels: { team: node.id === 'parent' ? 'red' : node.kubeObject.metadata.labels.team },
          },
        },
      })),
    };
    rerender(<CrossplaneMap />);
    expect(pending).toHaveLength(2);
    expect(mocks.fitView).not.toHaveBeenCalled();
    await act(async () => pending[0].finish(700));
    expect(mocks.nodes).toHaveLength(4);
    expect(mocks.fitView).not.toHaveBeenCalled();
    await act(async () => pending[1].finish(100));
    expect(mocks.nodes.map(node => node.id)).toEqual(['grandchild', 'leaf']);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
    mocks.source.current = filteringGraph();
    rerender(<CrossplaneMap />);
    expect(pending).toHaveLength(3);
    await act(async () => pending[2].finish(200));
    expect(mocks.nodes.map(node => node.id)).toEqual(['parent', 'grandchild', 'leaf']);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
  });

  it('completes an empty replacement instead of deferring its fit to future live matches', async () => {
    const { rerender } = await renderBlueFilter();
    const pending = delayedLayouts();
    fireEvent.click(matchingCheckbox());
    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({
        ...node,
        kubeObject: {
          ...node.kubeObject,
          metadata: { ...node.kubeObject.metadata, labels: { team: 'red' } },
        },
      })),
    };
    rerender(<CrossplaneMap />);
    await waitFor(() => expect(mocks.nodes).toHaveLength(0));
    expect(matchingCheckbox().checked).toBe(true);
    expect(pending).toHaveLength(1);
    expect(mocks.fitView).not.toHaveBeenCalled();
    await act(async () => pending[0].finish(1000));
    expect(mocks.nodes).toHaveLength(0);
    mocks.source.current = filteringGraph();
    rerender(<CrossplaneMap />);
    expect(pending).toHaveLength(2);
    await act(async () => pending[1].finish(50));
    expect(mocks.nodes).toHaveLength(3);
    expect(mocks.fitView).not.toHaveBeenCalled();
  });

  it('fulfills a pending return fit on an unchanged committed matching input', async () => {
    const { rerender } = await renderBlueFilter();
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({
        ...node,
        kubeObject: {
          ...node.kubeObject,
          metadata: {
            ...node.kubeObject.metadata,
            ...(node.id === 'child' ? { namespace: 'team-a' } : {}),
          },
        },
      })),
    };
    rerender(<CrossplaneMap />);
    const pending = delayedLayouts();
    fireEvent.click(matchingCheckbox());
    expect(pending).toHaveLength(1);
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(2));
    expect(matchingCheckbox().checked).toBe(true);
    expect(mocks.nodes).toHaveLength(3);
    await act(async () => pending[0].finish(1000));
    expect(mocks.nodes).toHaveLength(3);
    expect(mocks.fitView).toHaveBeenCalledTimes(2);
    expect(mocks.setViewport).not.toHaveBeenCalled();
  });

  it('preserves the original context viewport during rapid reversals before return layout commits', async () => {
    const { rerender } = await renderBlueFilter();
    const originalViewport = { x: 15, y: 25, zoom: 0.55 };
    mocks.viewport = originalViewport;
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    const matchingPositions = positions();
    mocks.viewport = { x: -1000, y: -800, zoom: 2 };
    const graph = filteringGraph();
    const excluded = {
      ...graph.nodes[1],
      id: 'new-excluded',
      kubeObject: {
        ...graph.nodes[1].kubeObject,
        metadata: { name: 'new-excluded', labels: { team: 'red' } },
      },
    };
    mocks.source.current = { ...graph, nodes: [...graph.nodes, excluded] };
    rerender(<CrossplaneMap />);
    const pending = delayedLayouts();
    fireEvent.click(matchingCheckbox());
    expect(pending).toHaveLength(1);
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(2));
    expect(positions()).toEqual(matchingPositions);
    mocks.source.current = filteringGraph();
    rerender(<CrossplaneMap />);
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.setViewport).toHaveBeenCalledTimes(1));
    expect(mocks.setViewport.mock.calls[0][0]).toEqual(originalViewport);
    expect(mocks.nodes).toHaveLength(4);
    await act(async () => pending[0].finish(1000));
    expect(mocks.nodes).toHaveLength(4);
    expect(mocks.setViewport).toHaveBeenCalledTimes(1);
  });

  it('transfers an unfinished invalidated return fit when live full topology changes again', async () => {
    const { rerender } = await renderBlueFilter();
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    const graph = filteringGraph();
    mocks.source.current = {
      ...graph,
      edges: graph.edges.filter(edge => edge.id !== 'parent-child'),
    };
    rerender(<CrossplaneMap />);
    const pending = delayedLayouts();
    fireEvent.click(matchingCheckbox());
    expect(pending).toHaveLength(1);
    mocks.source.current = {
      ...graph,
      edges: graph.edges.filter(edge => edge.id !== 'child-grandchild'),
    };
    rerender(<CrossplaneMap />);
    expect(pending).toHaveLength(2);
    await act(async () => pending[0].finish(700));
    expect(mocks.nodes).toHaveLength(3);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
    await act(async () => pending[1].finish(100));
    expect(mocks.nodes).toHaveLength(4);
    expect(mocks.fitView).toHaveBeenCalledTimes(2);
    expect(mocks.setViewport).not.toHaveBeenCalled();
  });

  it('shows a failed requested layout with explicit Retry and does not leak fit work into live updates', async () => {
    const { rerender } = await renderBlueFilter();
    const fullPositions = positions();
    const pending = delayedLayouts();
    fireEvent.click(matchingCheckbox());
    await act(async () => pending[0].fail());
    expect(screen.getByRole('alert').textContent).toContain('Could not arrange the map.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(matchingCheckbox().checked).toBe(true);
    expect(positions()).toEqual(fullPositions);
    expect(mocks.fitView).not.toHaveBeenCalled();
    mocks.source.current = {
      ...filteringGraph(),
      nodes: filteringGraph().nodes.map(node => ({ ...node, providerName: 'updated-provider' })),
    };
    rerender(<CrossplaneMap />);
    expect(pending).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(pending).toHaveLength(2);
    expect(mocks.fitView).not.toHaveBeenCalled();
    await act(async () => pending[1].finish(50));
    expect(mocks.nodes).toHaveLength(3);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retries a failed filter-change layout without reusing the committed matching layout', async () => {
    await renderBlueFilter();
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
    const pending = delayedLayouts();
    selectStatus('Ready');
    expect(matchingCheckbox().checked).toBe(true);
    expect(pending).toHaveLength(1);
    await act(async () => pending[0].fail());
    expect(screen.getByRole('alert').textContent).toContain('Could not arrange the map.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(pending).toHaveLength(2);
    expect(pending[1].input.children.map((resource: any) => resource.id)).toEqual([
      'parent',
      'grandchild',
      'leaf',
    ]);
    await act(async () => pending[1].finish(100));
    expect(mocks.nodes).toHaveLength(3);
    expect(node('parent').position).toEqual({ x: 100, y: 100 });
    expect(mocks.fitView).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears viewport work after a failed live layout until an explicit retry transition', async () => {
    const { rerender } = await renderBlueFilter();
    fireEvent.click(matchingCheckbox());
    await waitFor(() => expect(mocks.nodes).toHaveLength(3));
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));
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
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => pending[1].finish());
    expect(mocks.nodes).toHaveLength(4);
    expect(mocks.fitView).toHaveBeenCalledTimes(2);
  });

  it('ignores both a delayed layout and its viewport action after unmount', async () => {
    const { unmount } = await renderBlueFilter();
    const pending = delayedLayouts();
    fireEvent.click(matchingCheckbox());
    unmount();
    await act(async () => pending[0].finish(900));
    expect(mocks.fitView).not.toHaveBeenCalled();
    expect(mocks.setViewport).not.toHaveBeenCalled();
  });

  it('discards delayed mode geometry and viewport work when the cluster switches', async () => {
    const { rerender } = await renderBlueFilter();
    const pending = delayedLayouts();
    fireEvent.click(matchingCheckbox());
    mocks.cluster.current = 'cluster-b';
    rerender(<CrossplaneMap />);
    expect(pending).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: 'Hide non-matching' })).toBeNull();
    await act(async () => pending[1].finish(50));
    expect(mocks.nodes).toHaveLength(4);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
    const newPositions = positions();
    await act(async () => pending[0].finish(900));
    expect(positions()).toEqual(newPositions);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);
    expect(mocks.setViewport).not.toHaveBeenCalled();
  });
});
