import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { ProviderRevision } from '../common/Resources';
import { Provider } from '../providers/provider';
import { useCustomResourceLists } from './useCustomResources';

// ── Status helpers ────────────────────────────────────────────────────────────

export type StatusColor = 'success' | 'error' | 'warning';

export function getConditionStatus(resource: any, type: string): StatusColor {
  const conditions: any[] = resource?.jsonData?.status?.conditions ?? [];
  const cond = conditions.find((c: any) => c.type === type);
  if (!cond) return 'warning';
  if (cond.status === 'True') return 'success';
  if (cond.status === 'False') return 'error';
  return 'warning';
}

export function getReadyStatus(resource: any): StatusColor {
  return getConditionStatus(resource, 'Ready');
}

export function getSyncedStatus(resource: any): StatusColor {
  return getConditionStatus(resource, 'Synced');
}

export function isReady(resource: any): boolean {
  return getReadyStatus(resource) === 'success';
}

export function isSynced(resource: any): boolean {
  return getSyncedStatus(resource) === 'success';
}

// Returns the message field of a condition by type, or ''.
export function getConditionMessage(resource: any, type: string): string {
  const conditions: any[] =
    resource?.status?.conditions ?? resource?.jsonData?.status?.conditions ?? [];
  return conditions.find((c: any) => c.type === type)?.message ?? '';
}

// ── ApiProxy accessor ─────────────────────────────────────────────────────────

/**
 * Returns the Headlamp ApiProxy. In v0.39+ it lives at pluginLib.ApiProxy
 * (not under K8s). The SDK import may not shim it correctly, so we always
 * read from pluginLib at call time.
 */
export function getApiProxy(): any {
  return (K8s as any).ApiProxy ?? (window as any).pluginLib?.ApiProxy;
}

// ── CRD discovery via ProviderRevision ───────────────────────────────────────

/**
 * Returns all CRDs owned by a given provider, using the ProviderRevision's
 * status.objectRefs list — the authoritative source of truth.
 */
export function useCRDsForProvider(_providerName: string, currentRevision: string) {
  const [revisions] = ProviderRevision.useList();
  const [allCrds, crdErr] = K8s.ResourceClasses.CustomResourceDefinition.useList();

  if (!allCrds) return [null, crdErr] as const;

  // Find the active revision for this provider
  const revision = revisions?.find((r: any) => r.metadata?.name === currentRevision);
  const objectRefs: any[] = revision?.jsonData?.status?.objectRefs ?? [];
  const refNames = new Set(objectRefs.map((r: any) => r.name));

  if (refNames.size === 0) return [[] as any[], crdErr] as const;

  const filtered = allCrds.filter((crd: any) => refNames.has(crd.metadata?.name));
  return [filtered, crdErr] as const;
}

// ── CRD discovery hook (legacy group-based) ──────────────────────────────────

export function useCRDsForGroup(providerGroup: string) {
  const [crds, error] = K8s.ResourceClasses.CustomResourceDefinition.useList();
  if (!providerGroup || !crds) return [null, error] as const;
  const filtered = crds.filter((crd: any) => {
    const group: string = crd.jsonData?.spec?.group ?? '';
    return group === providerGroup;
  });
  return [filtered, error] as const;
}

// ── Provider group derivation (legacy fallback) ───────────────────────────────

export function deriveProviderGroupFromImage(packageRef: string): string {
  const imageName = packageRef.split('/').pop()?.split(':')[0] ?? '';
  const shortName = imageName.replace(/^provider-/, '');
  return shortName ? `${shortName}.crossplane.io` : '';
}

// ── Provider pod link helper ─────────────────────────────────────────────────

export function providerPodLogsUrl(cluster: string, namespace: string, podName: string): string {
  return `/c/${cluster}/pods/${namespace}/${podName}/logs`;
}

// ── Cluster-aware routing ────────────────────────────────────────────────────

export function clusterPrefix(): string {
  // Headlamp may be served under a base path (e.g. /api/headlamp) — strip it first.
  const base = (window as any).headlampBaseUrl ?? '';
  const pathname =
    base && window.location.pathname.startsWith(base)
      ? window.location.pathname.slice(base.length)
      : window.location.pathname;
  const match = pathname.match(/^(\/c\/[^/]+)/);
  return match?.[1] ?? '';
}

// ── Non-managed CRD types (infrastructure resources, no Ready/Synced) ────────

// These CRDs are owned by providers but are NOT managed resources.
// They don't have Ready/Synced conditions and must be excluded from MR counts,
// health stats, and the Resources view.
export const NON_MANAGED_PLURALS = new Set([
  'providerconfigs',
  'providerconfig',
  'providerconfigusages',
  'providerconfigusage',
  'storeconfigs',
  'storeconfig',
  'resourceusages',
  'resourceusage',
]);

// ── Flat MR type ─────────────────────────────────────────────────────────────

export interface FlatMR {
  _providerName: string;
  _group: string;
  _plural: string;
  _kind: string;
  _scope: string;
  [key: string]: any;
}

// ── useAllManagedResources ────────────────────────────────────────────────────

/** Watches managed resource instances across the active revision of each provider. */
export function useAllManagedResources(filterProviderName?: string): {
  items: FlatMR[];
  loading: boolean;
} {
  const [allCrds] = K8s.ResourceClasses.CustomResourceDefinition.useList();
  const [revisions] = ProviderRevision.useList();
  const [providers] = Provider.useList();

  const resources: { crd: any; providerName: string }[] = [];
  if (allCrds && revisions && providers) {
    for (const provider of providers) {
      const providerName = provider.metadata.name;
      if (filterProviderName && providerName !== filterProviderName) continue;
      const revision = revisions.find((r: any) => r.metadata.name === provider.currentRevision);
      const refs = new Set(
        (revision?.jsonData?.status?.objectRefs ?? []).map((ref: any) => ref.name)
      );
      for (const crd of allCrds) {
        if (
          refs.has(crd.metadata.name) &&
          !NON_MANAGED_PLURALS.has(crd.jsonData.spec.names.plural)
        ) {
          resources.push({ crd, providerName });
        }
      }
    }
  }

  const { lists, loading } = useCustomResourceLists(
    allCrds && revisions && providers ? resources.map(r => r.crd) : null
  );
  const items: FlatMR[] = resources.flatMap(({ crd, providerName }) => {
    const spec = crd.jsonData.spec;
    return (lists.get(crd.metadata.name) ?? []).map(item => ({
      ...item,
      _providerName: providerName,
      _group: spec.group,
      _plural: spec.names.plural,
      _kind: spec.names.kind,
      _scope: spec.scope,
    }));
  });

  return { items, loading };
}

// ── detectExternalManager ────────────────────────────────────────────────────

export type ExternalManager =
  | 'helm'
  | 'flux-kustomization'
  | 'flux-helmrelease'
  | 'argocd'
  | 'kro'
  | null;

export interface ExternalManagerInfo {
  manager: ExternalManager;
  ref: string;
}

export function detectExternalManager(resource: any): ExternalManagerInfo {
  const annotations: Record<string, string> = resource?.metadata?.annotations ?? {};
  const labels: Record<string, string> = resource?.metadata?.labels ?? {};

  if (labels['helm.sh/chart'] || labels['app.kubernetes.io/managed-by'] === 'Helm') {
    return {
      manager: 'helm',
      ref: labels['helm.sh/chart'] ?? labels['app.kubernetes.io/instance'] ?? '',
    };
  }
  if (annotations['kustomize.toolkit.fluxcd.io/name']) {
    return { manager: 'flux-kustomization', ref: annotations['kustomize.toolkit.fluxcd.io/name'] };
  }
  if (annotations['helm.toolkit.fluxcd.io/name']) {
    return { manager: 'flux-helmrelease', ref: annotations['helm.toolkit.fluxcd.io/name'] };
  }
  if (annotations['argocd.argoproj.io/app-name'] || labels['argocd.argoproj.io/app-name']) {
    return {
      manager: 'argocd',
      ref: annotations['argocd.argoproj.io/app-name'] ?? labels['argocd.argoproj.io/app-name'],
    };
  }
  if (labels['kro.run/resourcegraphgroup'] || labels['kro.run/instance']) {
    return {
      manager: 'kro',
      ref: labels['kro.run/instance'] ?? labels['kro.run/resourcegraphgroup'] ?? '',
    };
  }

  return { manager: null, ref: '' };
}
