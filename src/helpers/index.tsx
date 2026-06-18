import { useEffect, useState } from 'react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { ProviderRevision } from '../common/Resources';

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
  const conditions: any[] = resource?.status?.conditions ?? resource?.jsonData?.status?.conditions ?? [];
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
  const crdNames = new Set(
    objectRefs.filter((r: any) => r.kind === 'CustomResourceDefinition').map((r: any) => r.name)
  );

  if (crdNames.size === 0) return [[] as any[], crdErr] as const;

  const filtered = allCrds.filter((crd: any) => crdNames.has(crd.metadata?.name));
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

export function providerPodLogsUrl(
  cluster: string,
  namespace: string,
  podName: string
): string {
  return `/c/${cluster}/pods/${namespace}/${podName}/logs`;
}

// ── Cluster-aware routing ────────────────────────────────────────────────────

export function clusterPrefix(): string {
  // Headlamp may be served under a base path (e.g. /api/headlamp) — strip it first.
  const base = (window as any).headlampBaseUrl ?? '';
  const pathname = base && window.location.pathname.startsWith(base)
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

/**
 * Fetches all managed resource instances across all providers.
 * Fires parallel requests for every CRD type owned by every provider.
 * Returns a flat array of instances with provider metadata attached.
 *
 * Pass `filterProviderName` to scope to a single provider.
 */
export function useAllManagedResources(filterProviderName?: string): {
  items: FlatMR[];
  loading: boolean;
} {
  const [providers] = (K8s as any).ResourceClasses?.Provider
    ? (K8s as any).ResourceClasses.Provider.useList()
    : [null];

  // We need Provider list — import it dynamically to avoid circular dep
  // Instead we receive it via a separate hook usage below
  const [allCrds] = K8s.ResourceClasses.CustomResourceDefinition.useList();
  const [revisions] = ProviderRevision.useList();

  const [items, setItems] = useState<FlatMR[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!allCrds || !revisions) return;

    // Build map: revisionName → crds[]
    const revisionCrdMap = new Map<string, any[]>();
    for (const rev of revisions ?? []) {
      const refs: any[] = rev.jsonData?.status?.objectRefs ?? [];
      const crdNames = new Set(
        refs.filter((r: any) => r.kind === 'CustomResourceDefinition').map((r: any) => r.name)
      );
      const crds = (allCrds as any[]).filter((c: any) => crdNames.has(c.metadata?.name));
      revisionCrdMap.set(rev.metadata?.name, crds);
    }

    // We fetch provider list ourselves via direct API call
    getApiProxy()
      .request('/apis/pkg.crossplane.io/v1/providers', { isJSON: true })
      .then((res: any) => {
        const providerList: any[] = res?.items ?? [];
        const filtered = filterProviderName
          ? providerList.filter((p: any) => p.metadata?.name === filterProviderName)
          : providerList;

        const allFetches: Promise<FlatMR[]>[] = [];

        for (const provider of filtered) {
          const providerName: string = provider.metadata?.name ?? '';
          const currentRevision: string = provider.status?.currentRevision ?? '';
          const crds = revisionCrdMap.get(currentRevision) ?? [];

          for (const crd of crds) {
            const group: string = crd.jsonData?.spec?.group ?? '';
            const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
            const kind: string = crd.jsonData?.spec?.names?.kind ?? '';
            const scope: string = crd.jsonData?.spec?.scope ?? 'Cluster';
            const topVersion: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';

            // Skip infrastructure CRDs — they have no Ready/Synced conditions
            if (NON_MANAGED_PLURALS.has(plural)) continue;

            const fetch = getApiProxy()
              .request(`/apis/${group}/${topVersion}/${plural}`, { isJSON: true })
              .then((r: any) =>
                (r?.items ?? []).map((item: any) => ({
                  ...item,
                  _providerName: providerName,
                  _group: group,
                  _plural: plural,
                  _kind: kind,
                  _scope: scope,
                }))
              )
              .catch(() => [] as FlatMR[]);

            allFetches.push(fetch);
          }
        }

        return Promise.all(allFetches);
      })
      .then((results: FlatMR[][]) => {
        setItems(results.flat());
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [allCrds, revisions, filterProviderName]);

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
    return { manager: 'helm', ref: labels['helm.sh/chart'] ?? labels['app.kubernetes.io/instance'] ?? '' };
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
