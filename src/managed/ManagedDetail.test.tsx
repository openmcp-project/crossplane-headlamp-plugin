import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const Container = ({ children }: any) => children;
  const launch = vi.fn();
  const update = vi.fn();
  (window as any).pluginLib = {
    Activity: { launch, update },
    MuiCore: {
      Typography: Container,
      Box: Container,
      Chip: ({ label }: any) => label,
      CircularProgress: () => 'Loading',
      Paper: Container,
      Alert: Container,
      Accordion: Container,
      AccordionSummary: Container,
      AccordionDetails: Container,
    },
  };
  return { launch, update, clusterRequest: vi.fn(), crds: [] as any[] };
});

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    useCluster: () => 'cluster-a',
    ApiProxy: { clusterRequest: (...args: any[]) => mocks.clusterRequest(...args) },
    ResourceClasses: { CustomResourceDefinition: { useList: () => [mocks.crds, null] } },
  },
}));
vi.mock('../helpers', () => ({
  clusterPrefix: () => '/c/cluster-a',
  detectExternalManager: () => ({ manager: null }),
}));
vi.mock('../common/YamlView', () => ({ ViewYamlButton: () => null, YamlSection: () => null }));
vi.mock('../crds/CRDList', () => ({ openCRDDetailByGroupPlural: vi.fn() }));

import { openManagedDetail } from './ManagedDetail';

const detail = { group: 'example.org', plural: 'buckets', name: 'sample', namespace: 'team-a' };
const response = (version: string, ready: boolean) => ({
  kind: 'BucketList',
  items: [
    {
      kind: 'Bucket',
      apiVersion: `example.org/${version}`,
      metadata: { name: detail.name, namespace: detail.namespace },
      status: { conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }] },
    },
  ],
});

beforeEach(() => {
  vi.useFakeTimers();
  mocks.launch.mockClear();
  mocks.update.mockClear();
  mocks.clusterRequest.mockReset();
  mocks.crds = [
    {
      metadata: { name: 'buckets.example.org' },
      jsonData: {
        spec: {
          group: 'example.org',
          scope: 'Namespaced',
          names: { plural: 'buckets', singular: 'bucket', kind: 'Bucket' },
          versions: [
            { name: 'v1beta1', served: true, storage: false },
            { name: 'v1', served: true, storage: true },
          ],
        },
      },
    },
  ];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each([undefined, 'v1beta1'])(
  'refreshes the resource detail using the requested or storage API version (%s)',
  async version => {
    const expectedVersion = version ?? 'v1';
    mocks.clusterRequest.mockResolvedValue(response(expectedVersion, false));
    openManagedDetail({ ...detail, version });
    render(<MemoryRouter>{mocks.launch.mock.calls[0][0].content}</MemoryRouter>);
    await act(async () => {});

    expect(mocks.clusterRequest).toHaveBeenCalledWith(
      `/apis/example.org/${expectedVersion}/namespaces/team-a/buckets?fieldSelector=metadata.name%3Dsample`,
      { cluster: 'cluster-a' }
    );
    expect(screen.getByText(`example.org/${expectedVersion}`)).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'False' })).toBeTruthy();

    mocks.clusterRequest.mockResolvedValue(response(expectedVersion, true));
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.queryByRole('cell', { name: 'False' })).toBeNull();
    expect(screen.getByRole('cell', { name: 'True' })).toBeTruthy();
    expect(mocks.clusterRequest).toHaveBeenCalledTimes(2);
  }
);

it('updates a pinned detail when its API version changes and discards the old poll response', async () => {
  mocks.clusterRequest.mockResolvedValue(response('v1beta1', false));
  openManagedDetail({ ...detail, version: 'v1beta1' });
  const activityId = mocks.launch.mock.calls[0][0].id;
  const { rerender } = render(<MemoryRouter>{mocks.launch.mock.calls[0][0].content}</MemoryRouter>);
  await act(async () => {});

  let resolvePrevious!: (value: ReturnType<typeof response>) => void;
  mocks.clusterRequest.mockImplementationOnce(
    () => new Promise(resolve => (resolvePrevious = resolve))
  );
  await act(async () => {
    vi.advanceTimersByTime(10000);
  });
  mocks.clusterRequest.mockResolvedValue(response('v1', true));
  openManagedDetail({ ...detail, version: 'v1' });
  expect(mocks.update.mock.calls[1][0]).toBe(activityId);
  rerender(<MemoryRouter>{mocks.update.mock.calls[1][1].content}</MemoryRouter>);
  expect(screen.queryByText('example.org/v1beta1')).toBeNull();
  await act(async () => {});
  expect(screen.getByText('example.org/v1')).toBeTruthy();

  await act(async () => {
    resolvePrevious(response('v1beta1', false));
  });
  expect(screen.getByText('example.org/v1')).toBeTruthy();
  expect(screen.getByRole('cell', { name: 'True' })).toBeTruthy();
  expect(screen.queryByRole('cell', { name: 'False' })).toBeNull();
});
