import { resolveItemRefs } from './references';
import { GraphEdge, GraphNode, ManagedInstance } from './types';

function isReadyAndSynced(instance: ManagedInstance): boolean {
  const conditions = instance.status?.conditions ?? instance.jsonData?.status?.conditions ?? [];
  const ready = conditions.find((c: any) => c.type === 'Ready')?.status === 'True';
  const synced = conditions.find((c: any) => c.type === 'Synced')?.status === 'True';
  return ready && synced;
}

export function buildManagedGraph(
  instances: ManagedInstance[],
  crds: any[],
  providerByCRD: Map<string, string> = new Map()
) {
  // (group, kind) → "plural.group" ref for the node's customResourceDefinition.
  const crdRefByGroupKind = new Map<string, string>();
  crds.forEach((crd: any) => {
    const group: string = crd.jsonData?.spec?.group ?? '';
    const kind: string = crd.jsonData?.spec?.names?.kind ?? '';
    const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
    if (group && kind && plural) crdRefByGroupKind.set(`${group}/${kind}`, `${plural}.${group}`);
  });

  // Adapt each KubeObject to the plain resource shape the derivation reads
  // (spec/kind/apiVersion/metadata top-level). The raw resource lives under
  // jsonData; fall back to the instance itself.
  type ManagedResourceRecord = {
    instance: ManagedInstance;
    rawResource: any;
    name: string;
    kind: string;
    apiVersion: string;
    id: string;
  };
  const recordById = new Map<string, ManagedResourceRecord>();
  instances.forEach(instance => {
    const rawResource = instance.jsonData ?? instance;
    const name: string = rawResource?.metadata?.name ?? '';
    const kind: string = rawResource?.kind ?? instance._kind ?? '';
    const apiVersion: string = rawResource?.apiVersion ?? '';
    if (!name || !kind) return;
    const group = apiVersion.includes('/') ? apiVersion.split('/')[0] : '';
    // Use raw UIDs so nodes deduplicate with Headlamp's native custom-resource map sources.
    const id =
      rawResource.metadata?.uid ??
      `resource:${encodeURIComponent(
        JSON.stringify([group, kind, rawResource.metadata?.namespace ?? '', name])
      )}`;
    recordById.set(id, { instance, rawResource, name, kind, apiVersion, id });
  });

  // Each CRD is fetched at one selected version. Only repeated occurrences
  // of the same resource ID are collapsed; names are not resource identities.
  const records = Array.from(recordById.values());
  const idsByNameAndKind = new Map<string, Set<string>>();
  records.forEach(record => {
    const key = `${record.name}::${record.kind}`;
    const ids = idsByNameAndKind.get(key) ?? new Set<string>();
    ids.add(record.id);
    idsByNameAndKind.set(key, ids);
  });

  const singleId = (ids: Set<string> | undefined) =>
    ids?.size === 1 ? ids.values().next().value : undefined;

  const subaccountKey = (rawResource: any): string => {
    const forProvider = rawResource?.spec?.forProvider;
    const direct = forProvider?.subaccountRef?.name ?? forProvider?.subaccountId;
    if (direct) return direct;
    const managerName = forProvider?.serviceManagerRef?.name;
    const managerId = managerName
      ? singleId(idsByNameAndKind.get(`${managerName}::ServiceManager`))
      : undefined;
    const manager = managerId
      ? recordById.get(managerId)?.rawResource?.spec?.forProvider
      : undefined;
    return manager?.subaccountRef?.name ?? manager?.subaccountId ?? '';
  };

  // Alt index for the ServiceInstance→Entitlement predicate rule, scoped by subaccount.
  const entitlementIdsByServiceKey = new Map<string, Set<string>>();
  records.forEach(record => {
    if (record.kind !== 'Entitlement') return;
    const forProvider = record.rawResource?.spec?.forProvider;
    const serviceName = forProvider?.serviceName as string | undefined;
    const servicePlanName = forProvider?.servicePlanName as string | undefined;
    if (serviceName && servicePlanName) {
      const key = `${subaccountKey(record.rawResource)}::${serviceName}::${servicePlanName}`;
      const ids = entitlementIdsByServiceKey.get(key) ?? new Set<string>();
      ids.add(record.id);
      entitlementIdsByServiceKey.set(key, ids);
    }
  });

  const nodes: GraphNode[] = records.map(record => {
    const group = record.apiVersion.includes('/') ? record.apiVersion.split('/')[0] : '';
    const customResourceDefinition = crdRefByGroupKind.get(`${group}/${record.kind}`);
    return {
      id: record.id,
      kubeObject: record.instance,
      status: isReadyAndSynced(record.instance) ? 'success' : 'error',
      customResourceDefinition,
      providerName: customResourceDefinition
        ? providerByCRD.get(customResourceDefinition)
        : undefined,
    };
  });

  const parentEdges: GraphEdge[] = [];
  const auxEdges: GraphEdge[] = [];
  records.forEach(record => {
    const { parentId, extraIds } = resolveItemRefs(
      record.rawResource,
      record.kind,
      (refName, targetKind) => {
        if (!refName || !targetKind) return undefined;
        if (targetKind === 'Entitlement' && refName.includes('::')) {
          return singleId(
            entitlementIdsByServiceKey.get(`${subaccountKey(record.rawResource)}::${refName}`)
          );
        }
        return singleId(idsByNameAndKind.get(`${refName}::${targetKind}`));
      }
    );

    // A resolvable parent gets the single solid link; otherwise the MR is a
    // root of the forest (Provider/ProviderConfig are no longer nodes).
    if (parentId) {
      parentEdges.push({
        id: `edge-${parentId}-${record.id}`,
        source: parentId,
        target: record.id,
      });
    }

    for (const extraId of extraIds) {
      auxEdges.push({
        id: `edge-aux-${extraId}-${record.id}`,
        source: extraId,
        target: record.id,
      });
    }
  });

  return { nodes, parentEdges, auxEdges };
}
