import { K8s } from '@kinvolk/headlamp-plugin/lib';

export function apiProxyRoot(group: string, version: string): string {
  return group ? `/apis/${group}/${version}` : `/api/${version}`;
}

export interface ResourceDefinitionSpec {
  group: string;
  scope: string;
  names: { plural: string; singular: string; kind: string };
  versions: { name: string; served: boolean; storage: boolean }[];
}

/** Plain HTTP LIST request for a CRD type — no WebSocket, no watch. */
export async function listCRDResources(
  spec: ResourceDefinitionSpec,
  crdName: string,
  cluster: string,
  namespace?: string,
  name?: string
): Promise<any[]> {
  const apiProxy = (K8s as any).ApiProxy ?? (window as any).pluginLib?.ApiProxy;
  const version = spec.versions.find(v => v.storage) ?? spec.versions[0];
  const scopedPath =
    spec.scope === 'Namespaced' && namespace
      ? `namespaces/${namespace}/${spec.names.plural}`
      : spec.names.plural;
  const base = `${apiProxyRoot(spec.group, version.name)}/${scopedPath}`;
  const qs = name ? `?fieldSelector=metadata.name%3D${encodeURIComponent(name)}` : '';

  const response = await apiProxy.clusterRequest(`${base}${qs}`, { cluster });
  const items: any[] = response?.items ?? [];
  const fixedKind = (response?.kind ?? '').replace(/List$/, '') || spec.names.kind;
  return items.map((item: any) => {
    if (!item.kind) item.kind = fixedKind;
    if (!item.apiVersion) item.apiVersion = `${spec.group}/${version.name}`;
    return item;
  });
}
