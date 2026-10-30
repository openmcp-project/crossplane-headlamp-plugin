import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CrossplaneMap from './CrossplaneMap';

const mocks = vi.hoisted(() => ({
  source: { current: null as any },
  cluster: { current: 'cluster-a' },
  layout: vi.fn(),
  openDetails: vi.fn(),
  nodes: [] as any[],
  onNodesChange: vi.fn(),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useCluster: () => mocks.cluster.current },
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({ SectionHeader: () => null }));
vi.mock('@mui/material', async () => ({
  ...(await vi.importActual<typeof import('@mui/material')>('@mui/material')),
  useMediaQuery: () => true,
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
    Controls: () => null,
    Handle: () => null,
    MarkerType: { ArrowClosed: 'arrowclosed' },
    MiniMap: () => null,
    Panel: ({ children }: any) => <div>{children}</div>,
    Position: { Top: 'top', Bottom: 'bottom' },
    ReactFlow: ({ nodes, edges, children, onNodesChange }: any) => {
      mocks.nodes = nodes;
      mocks.onNodesChange = onNodesChange;
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
            <button key={node.id} type="button" onClick={node.data.onOpenDetails}>
              Open {node.data.name}
            </button>
          ))}
          {children}
        </div>
      );
    },
    useNodesState,
    useReactFlow: () => ({}),
  };
});

beforeEach(() => {
  mocks.layout.mockReset().mockImplementation(async graph => graph);
  mocks.openDetails.mockReset();
  mocks.source.current = null;
  mocks.cluster.current = 'cluster-a';
  mocks.nodes = [];
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
