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
  const match = window.location.pathname.match(/^(\/c\/[^/]+)/);
  return match?.[1] ?? '';
}
