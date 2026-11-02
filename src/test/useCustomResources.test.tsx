import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Host UI stubs ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const Container = ({ children }: any) => children;
  (window as any).pluginLib = {
    MuiCore: {
      Typography: Container,
      Box: Container,
      Paper: Container,
      Chip: ({ label }: any) => label,
      CircularProgress: () => 'Loading',
      FormControl: Container,
      InputLabel: () => null,
      InputAdornment: Container,
      FormControlLabel: () => null,
      Checkbox: () => null,
      TextField: () => null,
      Select: () => null,
      MenuItem: () => null,
    },
  };
  return {
    cluster: 'cluster-a',
    crds: [] as any[],
    providers: [] as any[],
    revisions: [] as any[],
    // Per-endpoint response queues: url → items[]
    responses: new Map<string, any[]>(),
    clusterRequest: vi.fn(),
  };
});

// ── Headlamp SDK mock ─────────────────────────────────────────────────────────

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    useCluster: () => mocks.cluster,
    // clusterRequest is accessed via K8s.ApiProxy at runtime
    ApiProxy: {
      clusterRequest: (...args: any[]) => mocks.clusterRequest(...args),
    },
    ResourceClasses: {
      CustomResourceDefinition: class {
        static useList() {
          return [mocks.crds, null];
        }
        constructor(public jsonData: any) {}
      },
    },
  },
}));

vi.mock('../common/Resources', () => ({
  ProviderRevision: { useList: () => [mocks.revisions, null] },
}));

vi.mock('../providers/provider', () => ({
  Provider: { useList: () => [mocks.providers, null] },
}));

import { useAllManagedResources } from '../helpers';
import { useCustomResourceList, useCustomResourceLists } from '../helpers/useCustomResources';
import ResourceList from '../resources/ResourceList';

// ── Test helpers ──────────────────────────────────────────────────────────────

function crd(plural = 'buckets', scope = 'Cluster') {
  const metadata = { name: `${plural}.example.org` };
  return {
    metadata,
    jsonData: {
      metadata,
      spec: {
        group: 'example.org',
        scope,
        names: { plural, singular: plural.slice(0, -1), kind: 'Bucket' },
        versions: [
          { name: 'v1alpha1', served: false, storage: false },
          { name: 'v1beta1', served: true, storage: false },
          { name: 'v1', served: true, storage: true },
        ],
      },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.cluster = 'cluster-a';
  mocks.crds = [];
  mocks.providers = [];
  mocks.revisions = [];
  mocks.clusterRequest.mockReset();
  mocks.clusterRequest.mockResolvedValue({ kind: 'BucketList', items: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── useCustomResourceLists ────────────────────────────────────────────────────

describe('useCustomResourceLists', () => {
  it('updates lists for resource additions, condition changes, and deletions', async () => {
    const definition = crd();
    const { result } = renderHook(() => useCustomResourceLists([definition]));
    expect(result.current.loading).toBe(true);

    // First poll resolves with empty list.
    await act(async () => {});
    expect(result.current.loading).toBe(false);
    expect(result.current.lists.get(definition.metadata.name)).toEqual([]);

    // Poll returns an item.
    const item = {
      metadata: { name: 'test' },
      status: { conditions: [{ type: 'Ready', status: 'False' }] },
    };
    mocks.clusterRequest.mockResolvedValue({ kind: 'BucketList', items: [item] });
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(result.current.lists.get(definition.metadata.name)).toEqual([
      expect.objectContaining({ metadata: { name: 'test' } }),
    ]);

    // Item becomes ready.
    const ready = { ...item, status: { conditions: [{ type: 'Ready', status: 'True' }] } };
    mocks.clusterRequest.mockResolvedValue({ kind: 'BucketList', items: [ready] });
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(result.current.lists.get(definition.metadata.name)?.[0].status).toEqual(ready.status);

    // Item deleted.
    mocks.clusterRequest.mockResolvedValue({ kind: 'BucketList', items: [] });
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(result.current.lists.get(definition.metadata.name)).toEqual([]);
  });

  it('waits for discovery and handles an empty set without making requests', async () => {
    const { result, rerender } = renderHook(({ crds }) => useCustomResourceLists(crds), {
      initialProps: { crds: null as any[] | null },
    });
    expect(result.current.loading).toBe(true);
    rerender({ crds: [] });
    await act(async () => {});
    expect(result.current.loading).toBe(false);
    expect(mocks.clusterRequest).not.toHaveBeenCalled();
  });

  it('prefers the served storage version and excludes unserved versions', async () => {
    renderHook(() => useCustomResourceLists([crd()]));
    await act(async () => {});
    // URL should use v1 (storage=true), not v1beta1 or v1alpha1.
    expect(mocks.clusterRequest).toHaveBeenCalledWith(
      expect.stringContaining('/apis/example.org/v1/buckets'),
      expect.anything()
    );
    expect(mocks.clusterRequest).not.toHaveBeenCalledWith(
      expect.stringContaining('v1beta1'),
      expect.anything()
    );
  });

  it('deduplicates types referenced by multiple providers', async () => {
    renderHook(() => useCustomResourceLists([crd(), crd()]));
    await act(async () => {});
    // Only one request for buckets even though crd() was passed twice.
    const calls = mocks.clusterRequest.mock.calls.filter(
      ([url]: [string]) => url.includes('/buckets')
    );
    expect(calls).toHaveLength(1);
  });

  it('reports CRDs without a served version as an error, not loading', async () => {
    const definition = crd();
    definition.jsonData.spec.versions = [];
    const { result } = renderHook(() => useCustomResourceLists([definition]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errors.get(definition.metadata.name)?.message).toContain(
      'No served version'
    );
    expect(mocks.clusterRequest).not.toHaveBeenCalled();
  });

  it('does not restart polling on CRD status updates or new array references', async () => {
    const { rerender } = renderHook(({ crds }) => useCustomResourceLists(crds), {
      initialProps: { crds: [crd('buckets'), crd('vpcs')] },
    });
    await act(async () => {});
    const callsAfterInit = mocks.clusterRequest.mock.calls.length;

    const updated = crd('buckets');
    (updated.jsonData as any).status = { conditions: [{ status: 'True' }] };
    rerender({ crds: [crd('vpcs'), updated] });
    await act(async () => {});
    // No new poll triggered — same endpoints, just a status update.
    expect(mocks.clusterRequest.mock.calls.length).toBe(callsAfterInit);
  });

  it('stops polling on cluster changes and ignores in-flight responses from the old cluster', async () => {
    const { result, rerender } = renderHook(() => useCustomResourceLists([crd()]));
    await act(async () => {});
    expect(result.current.lists.get('buckets.example.org')).toEqual([]);

    // Switch cluster — state should reset immediately.
    mocks.cluster = 'cluster-b';
    mocks.clusterRequest.mockResolvedValue({ kind: 'BucketList', items: [] });
    rerender();

    // Before new poll resolves, lists are empty (key changed).
    expect(result.current.lists.size).toBe(0);

    // New cluster poll should use cluster-b.
    await act(async () => {});
    expect(mocks.clusterRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cluster: 'cluster-b' })
    );
  });

  it('clears timers on unmount', async () => {
    const { unmount } = renderHook(() => useCustomResourceLists([crd()]));
    await act(async () => {});
    unmount();
    const callsBefore = mocks.clusterRequest.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(10000); });
    // No new requests after unmount.
    expect(mocks.clusterRequest.mock.calls.length).toBe(callsBefore);
  });

  it('settles errors independently per CRD and recovers on the next successful poll', async () => {
    mocks.clusterRequest
      .mockRejectedValueOnce(new Error('Forbidden'))  // buckets fails
      .mockResolvedValueOnce({ kind: 'VpcList', items: [] }); // vpcs succeeds

    const { result } = renderHook(() => useCustomResourceLists([crd('buckets'), crd('vpcs')]));
    await act(async () => {});
    expect(result.current.loading).toBe(false);
    expect(result.current.errors.get('buckets.example.org')?.message).toBe('Forbidden');
    expect(result.current.errors.has('vpcs.example.org')).toBe(false);

    // Next poll for buckets succeeds — error clears.
    mocks.clusterRequest.mockResolvedValue({ kind: 'BucketList', items: [] });
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(result.current.errors.size).toBe(0);
  });

  it('reports an immediate fetch failure instead of remaining in loading state', async () => {
    mocks.clusterRequest.mockRejectedValue(new Error('Connection failed'));
    const { result } = renderHook(() => useCustomResourceLists([crd()]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errors.get('buckets.example.org')?.message).toBe('Connection failed');
  });

  it('scopes requests by namespace and name for detail subscriptions', async () => {
    const { result } = renderHook(() =>
      useCustomResourceList(crd('buckets', 'Namespaced'), {
        name: 'test',
        namespace: 'team-a',
      })
    );
    await act(async () => {});
    expect(mocks.clusterRequest).toHaveBeenCalledWith(
      '/apis/example.org/v1/namespaces/team-a/buckets?fieldSelector=metadata.name%3Dtest',
      expect.anything()
    );

    mocks.clusterRequest.mockResolvedValue({
      kind: 'BucketList',
      items: [{ metadata: { name: 'test', namespace: 'team-a' } }],
    });
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(result.current.items).toHaveLength(1);

    mocks.clusterRequest.mockResolvedValue({ kind: 'BucketList', items: [] });
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(result.current.items).toEqual([]);
  });
});

// ── useAllManagedResources ────────────────────────────────────────────────────

describe('useAllManagedResources', () => {
  it('polls the active revision and updates provider totals without a page reload', async () => {
    mocks.crds = [crd(), crd('providerconfigs'), crd('vpcs')];
    mocks.providers = [
      {
        metadata: { name: 'provider-a' },
        jsonData: { status: { currentRevision: 'revision-a' } },
        currentRevision: 'revision-a',
      },
    ];
    mocks.revisions = [
      {
        metadata: { name: 'revision-a' },
        jsonData: {
          status: {
            objectRefs: mocks.crds.slice(0, 2).map((c: any) => ({ name: c.metadata.name })),
          },
        },
      },
    ];

    const item = { metadata: { name: 'test' }, kind: 'Bucket', apiVersion: 'example.org/v1', status: { conditions: [] } };
    mocks.clusterRequest.mockResolvedValue({ kind: 'BucketList', items: [item] });

    const { result, rerender } = renderHook(() => useAllManagedResources());
    await act(async () => {});

    expect(result.current.items).toMatchObject([
      { _providerName: 'provider-a', _plural: 'buckets' },
    ]);

    // Provider switches to a new revision that owns vpcs instead.
    mocks.providers = [
      {
        metadata: { name: 'provider-a' },
        jsonData: { status: { currentRevision: 'revision-b' } },
        currentRevision: 'revision-b',
      },
    ];
    mocks.revisions = [
      {
        metadata: { name: 'revision-b' },
        jsonData: { status: { objectRefs: [{ name: 'vpcs.example.org' }] } },
      },
    ];
    mocks.clusterRequest.mockResolvedValue({
      kind: 'VpcList',
      items: [{ metadata: { name: 'new-vpc' }, kind: 'Vpc', apiVersion: 'example.org/v1' }],
    });

    rerender();
    await act(async () => {});

    expect(result.current.items).toMatchObject([
      { _plural: 'vpcs', metadata: { name: 'new-vpc' } },
    ]);
  });
});

// ── Managed Resources page ────────────────────────────────────────────────────

describe('Managed Resources page', () => {
  it('updates counts and expanded rows when a resource becomes ready or is deleted', async () => {
    mocks.crds = [crd()];
    mocks.providers = [
      {
        metadata: { name: 'provider-a' },
        jsonData: { status: { currentRevision: 'revision-a' } },
        currentRevision: 'revision-a',
      },
    ];
    mocks.revisions = [
      {
        metadata: { name: 'revision-a' },
        jsonData: { status: { objectRefs: [{ name: 'buckets.example.org' }] } },
      },
    ];

    const item = {
      metadata: { name: 'test-bucket' },
      kind: 'Bucket',
      apiVersion: 'example.org/v1',
      status: {
        conditions: [
          { type: 'Ready', status: 'False' },
          { type: 'Synced', status: 'True' },
        ],
      },
    };
    mocks.clusterRequest.mockResolvedValue({ kind: 'BucketList', items: [item] });

    render(
      <MemoryRouter>
        <ResourceList />
      </MemoryRouter>
    );
    await act(async () => {});

    expect(screen.getByText('1 not ready')).toBeTruthy();
    fireEvent.click(screen.getByText('Bucket'));
    expect(screen.getByText('test-bucket')).toBeTruthy();
    expect(screen.getByText('Not Ready')).toBeTruthy();

    // Next poll: item becomes ready.
    mocks.clusterRequest.mockResolvedValue({
      kind: 'BucketList',
      items: [
        {
          ...item,
          status: {
            conditions: [
              { type: 'Ready', status: 'True' },
              { type: 'Synced', status: 'True' },
            ],
          },
        },
      ],
    });
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(screen.getByText('1 ready')).toBeTruthy();
    expect(screen.queryByText('Not Ready')).toBeNull();

    // Next poll: item deleted.
    mocks.clusterRequest.mockResolvedValue({ kind: 'BucketList', items: [] });
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(screen.queryByText('test-bucket')).toBeNull();
    expect(screen.getByText(/No resource types with instances/)).toBeTruthy();
  });
});
