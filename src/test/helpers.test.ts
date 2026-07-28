import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mock @kinvolk/headlamp-plugin/lib ────────────────────────────────────────
// Must be hoisted before the module under test is imported.
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ApiProxy: undefined,
    ResourceClasses: {
      CustomResourceDefinition: { useList: vi.fn(() => [[], null]) },
    },
  },
}));

vi.mock('../common/Resources', () => ({
  ProviderRevision: { useList: vi.fn(() => [[], null]) },
}));

import {
  getConditionStatus,
  getReadyStatus,
  getSyncedStatus,
  isReady,
  isSynced,
  getConditionMessage,
  deriveProviderGroupFromImage,
  providerPodLogsUrl,
  clusterPrefix,
  NON_MANAGED_PLURALS,
  detectExternalManager,
} from '../helpers';

// ── helpers for building mock resources ──────────────────────────────────────

function withCondition(type: string, status: string, message = '') {
  return {
    jsonData: {
      status: {
        conditions: [{ type, status, message }],
      },
    },
    status: {
      conditions: [{ type, status, message }],
    },
  };
}

// ── getConditionStatus ────────────────────────────────────────────────────────

describe('getConditionStatus', () => {
  it('returns success when condition status is True', () => {
    expect(getConditionStatus(withCondition('Ready', 'True'), 'Ready')).toBe('success');
  });

  it('returns error when condition status is False', () => {
    expect(getConditionStatus(withCondition('Ready', 'False'), 'Ready')).toBe('error');
  });

  it('returns warning when condition status is Unknown', () => {
    expect(getConditionStatus(withCondition('Ready', 'Unknown'), 'Ready')).toBe('warning');
  });

  it('returns warning when condition is missing', () => {
    expect(getConditionStatus({ jsonData: { status: { conditions: [] } } }, 'Ready')).toBe('warning');
  });

  it('returns warning when resource is null', () => {
    expect(getConditionStatus(null, 'Ready')).toBe('warning');
  });

  it('returns warning when conditions array is absent', () => {
    expect(getConditionStatus({ jsonData: {} }, 'Ready')).toBe('warning');
  });

  it('matches by type name, not position', () => {
    const resource = {
      jsonData: {
        status: {
          conditions: [
            { type: 'Synced', status: 'True' },
            { type: 'Ready', status: 'False' },
          ],
        },
      },
    };
    expect(getConditionStatus(resource, 'Ready')).toBe('error');
    expect(getConditionStatus(resource, 'Synced')).toBe('success');
  });
});

// ── getReadyStatus / getSyncedStatus ──────────────────────────────────────────

describe('getReadyStatus', () => {
  it('delegates to getConditionStatus with type Ready', () => {
    expect(getReadyStatus(withCondition('Ready', 'True'))).toBe('success');
    expect(getReadyStatus(withCondition('Ready', 'False'))).toBe('error');
  });
});

describe('getSyncedStatus', () => {
  it('delegates to getConditionStatus with type Synced', () => {
    expect(getSyncedStatus(withCondition('Synced', 'True'))).toBe('success');
    expect(getSyncedStatus(withCondition('Synced', 'False'))).toBe('error');
  });
});

// ── isReady / isSynced ────────────────────────────────────────────────────────

describe('isReady', () => {
  it('returns true only when Ready=True', () => {
    expect(isReady(withCondition('Ready', 'True'))).toBe(true);
    expect(isReady(withCondition('Ready', 'False'))).toBe(false);
    expect(isReady(withCondition('Ready', 'Unknown'))).toBe(false);
    expect(isReady(null)).toBe(false);
  });
});

describe('isSynced', () => {
  it('returns true only when Synced=True', () => {
    expect(isSynced(withCondition('Synced', 'True'))).toBe(true);
    expect(isSynced(withCondition('Synced', 'False'))).toBe(false);
  });
});

// ── getConditionMessage ───────────────────────────────────────────────────────

describe('getConditionMessage', () => {
  it('returns message from jsonData.status.conditions', () => {
    const r = withCondition('Ready', 'False', 'connect: connection refused');
    expect(getConditionMessage(r, 'Ready')).toBe('connect: connection refused');
  });

  it('falls back to status.conditions when jsonData path is absent', () => {
    const r = { status: { conditions: [{ type: 'Ready', status: 'False', message: 'timeout' }] } };
    expect(getConditionMessage(r, 'Ready')).toBe('timeout');
  });

  it('returns empty string when condition is missing', () => {
    expect(getConditionMessage({ jsonData: { status: { conditions: [] } } }, 'Ready')).toBe('');
  });

  it('returns empty string when resource is null', () => {
    expect(getConditionMessage(null, 'Ready')).toBe('');
  });
});

// ── deriveProviderGroupFromImage ──────────────────────────────────────────────

describe('deriveProviderGroupFromImage', () => {
  it('extracts group from standard provider image', () => {
    expect(deriveProviderGroupFromImage('xpkg.upbound.io/upbound/provider-aws:v0.40.0'))
      .toBe('aws.crossplane.io');
  });

  it('handles image without tag', () => {
    expect(deriveProviderGroupFromImage('xpkg.upbound.io/upbound/provider-gcp'))
      .toBe('gcp.crossplane.io');
  });

  it('handles image without provider- prefix', () => {
    expect(deriveProviderGroupFromImage('registry.io/org/aws:v1'))
      .toBe('aws.crossplane.io');
  });

  it('returns empty string for empty input', () => {
    expect(deriveProviderGroupFromImage('')).toBe('');
  });

  it('handles image name that is only provider- with no suffix', () => {
    expect(deriveProviderGroupFromImage('registry.io/org/provider-:v1')).toBe('');
  });
});

// ── providerPodLogsUrl ────────────────────────────────────────────────────────

describe('providerPodLogsUrl', () => {
  it('builds the correct Headlamp logs URL', () => {
    expect(providerPodLogsUrl('my-cluster', 'crossplane-system', 'provider-aws-abc123'))
      .toBe('/c/my-cluster/pods/crossplane-system/provider-aws-abc123/logs');
  });
});

// ── clusterPrefix ─────────────────────────────────────────────────────────────

describe('clusterPrefix', () => {
  beforeEach(() => {
    (global as any).headlampBaseUrl = '';
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { pathname: '/' },
    });
  });

  it('returns empty string when no cluster segment in path', () => {
    window.location = { pathname: '/crossplane/overview' } as any;
    expect(clusterPrefix()).toBe('');
  });

  it('extracts /c/<cluster> from path', () => {
    window.location = { pathname: '/c/my-cluster/crossplane/overview' } as any;
    expect(clusterPrefix()).toBe('/c/my-cluster');
  });

  it('strips headlampBaseUrl before matching', () => {
    (global as any).headlampBaseUrl = '/headlamp';
    window.location = { pathname: '/headlamp/c/staging/crossplane/overview' } as any;
    expect(clusterPrefix()).toBe('/c/staging');
  });

  it('does not strip base when path does not start with it', () => {
    (global as any).headlampBaseUrl = '/headlamp';
    window.location = { pathname: '/c/staging/crossplane/overview' } as any;
    expect(clusterPrefix()).toBe('/c/staging');
  });
});

// ── NON_MANAGED_PLURALS ───────────────────────────────────────────────────────

describe('NON_MANAGED_PLURALS', () => {
  const excluded = [
    'providerconfigs', 'providerconfig',
    'providerconfigusages', 'providerconfigusage',
    'storeconfigs', 'storeconfig',
    'resourceusages', 'resourceusage',
  ];

  const included = ['buckets', 'vpcs', 'clusters', 'databases', 'subnets'];

  it.each(excluded)('excludes %s', (plural) => {
    expect(NON_MANAGED_PLURALS.has(plural)).toBe(true);
  });

  it.each(included)('does not exclude managed resource type %s', (plural) => {
    expect(NON_MANAGED_PLURALS.has(plural)).toBe(false);
  });
});

// ── detectExternalManager ─────────────────────────────────────────────────────

describe('detectExternalManager', () => {
  it('detects helm via helm.sh/chart label', () => {
    const r = { metadata: { labels: { 'helm.sh/chart': 'mychart-1.0.0' }, annotations: {} } };
    expect(detectExternalManager(r)).toEqual({ manager: 'helm', ref: 'mychart-1.0.0' });
  });

  it('detects helm via managed-by=Helm label', () => {
    const r = {
      metadata: {
        labels: { 'app.kubernetes.io/managed-by': 'Helm', 'app.kubernetes.io/instance': 'my-release' },
        annotations: {},
      },
    };
    expect(detectExternalManager(r)).toEqual({ manager: 'helm', ref: 'my-release' });
  });

  it('detects flux-kustomization', () => {
    const r = {
      metadata: {
        labels: {},
        annotations: { 'kustomize.toolkit.fluxcd.io/name': 'infra-kustomization' },
      },
    };
    expect(detectExternalManager(r)).toEqual({ manager: 'flux-kustomization', ref: 'infra-kustomization' });
  });

  it('detects flux-helmrelease', () => {
    const r = {
      metadata: {
        labels: {},
        annotations: { 'helm.toolkit.fluxcd.io/name': 'my-helmrelease' },
      },
    };
    expect(detectExternalManager(r)).toEqual({ manager: 'flux-helmrelease', ref: 'my-helmrelease' });
  });

  it('detects argocd via annotation', () => {
    const r = {
      metadata: {
        labels: {},
        annotations: { 'argocd.argoproj.io/app-name': 'my-app' },
      },
    };
    expect(detectExternalManager(r)).toEqual({ manager: 'argocd', ref: 'my-app' });
  });

  it('detects argocd via label fallback', () => {
    const r = {
      metadata: {
        labels: { 'argocd.argoproj.io/app-name': 'my-app' },
        annotations: {},
      },
    };
    expect(detectExternalManager(r)).toEqual({ manager: 'argocd', ref: 'my-app' });
  });

  it('detects kro via label', () => {
    const r = {
      metadata: {
        labels: { 'kro.run/instance': 'my-instance' },
        annotations: {},
      },
    };
    expect(detectExternalManager(r)).toEqual({ manager: 'kro', ref: 'my-instance' });
  });

  it('returns null when no manager annotation/label present', () => {
    const r = { metadata: { labels: {}, annotations: {} } };
    expect(detectExternalManager(r)).toEqual({ manager: null, ref: '' });
  });

  it('returns null for resource with no metadata', () => {
    expect(detectExternalManager({})).toEqual({ manager: null, ref: '' });
  });

  it('returns null for null resource', () => {
    expect(detectExternalManager(null)).toEqual({ manager: null, ref: '' });
  });

  it('helm takes priority over flux annotations', () => {
    const r = {
      metadata: {
        labels: { 'helm.sh/chart': 'mychart-1.0' },
        annotations: { 'kustomize.toolkit.fluxcd.io/name': 'my-ks' },
      },
    };
    expect(detectExternalManager(r).manager).toBe('helm');
  });
});
