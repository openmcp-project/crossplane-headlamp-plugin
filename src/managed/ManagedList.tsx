import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { getApiProxy } from '../helpers';
import { xpColors } from '../common/colors';
import { ScopeBadge } from '../common/ScopeBadge';
import { openManagedDetail } from './ManagedDetail';

const { Typography, Box, Chip, CircularProgress } =
  (window as any).pluginLib?.MuiCore ?? {};
const { SectionBox } = (window as any).pluginLib?.CommonComponents ?? {};

function conditionChip(conditions: any[], type: string) {
  const cond = conditions?.find((c: any) => c.type === type);
  if (!cond) return <Chip label="—" size="small" />;
  const ok = cond.status === 'True';
  return (
    <Chip
      label={ok ? type : `Not ${type}`}
      size="small"
      style={{ background: ok ? xpColors.ready.bg : xpColors.notReady.bg, color: '#fff', fontWeight: 600 }}
    />
  );
}

function useCustomResourceList(group: string, version: string, plural: string) {
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    if (!group || !plural) return;
    const ver = version || 'v1alpha1';
    getApiProxy().request(`/apis/${group}/${ver}/${plural}`, { isJSON: true })
      .then((res: any) => setItems(res?.items ?? []))
      .catch((e: any) => setError(e));
  }, [group, version, plural]);

  return [items, error] as const;
}

export default function ManagedList() {
  const { providerName, group, plural } = useParams<{
    providerName: string;
    group: string;
    plural: string;
  }>();

  // Find the CRD to get version and scope
  const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList();
  const crd = crds?.find(
    (c: any) =>
      c.jsonData?.spec?.names?.plural === plural && c.jsonData?.spec?.group === group
  );

  const versions: string[] = crd?.jsonData?.spec?.versions?.map((v: any) => v.name) ?? [];
  const topVersion = versions[0] ?? 'v1alpha1';
  const kind: string = crd?.jsonData?.spec?.names?.kind ?? plural;

  const [items, error] = useCustomResourceList(group, topVersion, plural);

  if (!items && !error) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading {plural}…</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={3}>
        <Typography color="error">
          Failed to load {plural}: {String(error?.message ?? error)}
        </Typography>
      </Box>
    );
  }

  return (
    <SectionBox
      title={kind}
      subtitle={group}
      headerProps={{ headerStyle: 'main' }}
    >
      {!items || items.length === 0 ? (
        <Typography>No {plural} found.</Typography>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px' }}>Name</th>
              <th style={{ padding: '8px 12px' }}>Scope</th>
              <th style={{ padding: '8px 12px' }}>Ready</th>
              <th style={{ padding: '8px 12px' }}>Synced</th>
              <th style={{ padding: '8px 12px' }}>Age</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any) => {
              const itemName: string = item.metadata?.name ?? '';
              const ns: string = item.metadata?.namespace ?? '';
              const conditions: any[] = item.status?.conditions ?? [];
              const created = item.metadata?.creationTimestamp
                ? new Date(item.metadata.creationTimestamp).toLocaleDateString()
                : '—';

              return (
                <tr
                  key={`${ns}/${itemName}`}
                  style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                  onClick={() => openManagedDetail({ providerName, group, plural, name: itemName, namespace: ns || undefined })}
                >
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ color: xpColors.link, textDecoration: 'underline' }}>
                      {itemName}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <ScopeBadge scope={ns ? 'Namespaced' : 'Cluster'} namespace={ns || undefined} />
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {conditionChip(conditions, 'Ready')}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {conditionChip(conditions, 'Synced')}
                  </td>
                  <td style={{ padding: '8px 12px' }}>{created}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SectionBox>
  );
}
