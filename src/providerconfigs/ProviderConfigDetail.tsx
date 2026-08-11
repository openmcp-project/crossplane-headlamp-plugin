import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useCRDsForProvider, useAllManagedResources, getApiProxy } from '../helpers';
import { xpColors } from '../common/colors';
import { ScopeBadge } from '../common/ScopeBadge';
import { Provider } from '../common/Resources';
import { openManagedDetail } from '../managed/ManagedDetail';

const { Typography, Box, Chip, CircularProgress, Paper, Alert } =
  (window as any).pluginLib?.MuiCore ?? {};
const { SectionBox, SectionHeader, NameValueTable, SimpleTable } = (window as any).pluginLib?.CommonComponents ?? {};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProviderConfigDetailProps {
  providerName: string;
  configName: string;
}

// ── Activity launcher ─────────────────────────────────────────────────────────

export function openProviderConfigDetail(props: ProviderConfigDetailProps) {
  const Activity = (window as any).pluginLib?.Activity;
  if (!Activity?.launch) {
    console.warn('Activity.launch not available in this version of Headlamp');
    return;
  }
  const { providerName, configName } = props;
  Activity.launch({
    id: `providerconfig-detail:${providerName}/${configName}`,
    location: 'split-right',
    temporary: true,
    title: configName,
    content: <ProviderConfigDetailView {...props} />,
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function conditionChip(conditions: any[], type: string) {
  const cond = conditions?.find((c: any) => c.type === type);
  if (!cond) return <Chip label="—" size="small" />;
  const ok = cond.status === 'True';
  return (
    <Chip label={ok ? type : `Not ${type}`} size="small"
      style={{ background: ok ? xpColors.ready.bg : xpColors.notReady.bg, color: '#fff', fontWeight: 600 }} />
  );
}

// ── Core view ─────────────────────────────────────────────────────────────────

export function ProviderConfigDetailView({ providerName, configName }: ProviderConfigDetailProps) {
  const [providers] = Provider.useList();
  const provider = providers?.find((p: any) => p.metadata?.name === providerName);
  const currentRevision: string = provider?.jsonData?.status?.currentRevision ?? '';

  const [crds] = useCRDsForProvider(providerName, currentRevision);
  const configCrd = crds?.find((crd: any) => crd.jsonData?.spec?.names?.plural === 'providerconfigs');

  const [config, setConfig] = useState<any>(null);
  const [configError, setConfigError] = useState<any>(null);

  useEffect(() => {
    if (!configCrd) return;
    const group: string = configCrd.jsonData?.spec?.group ?? '';
    const topVersion: string = configCrd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
    getApiProxy()
      .request(`/apis/${group}/${topVersion}/providerconfigs/${configName}`, { isJSON: true })
      .then((res: any) => setConfig(res))
      .catch((e: any) => setConfigError(e));
  }, [configCrd?.metadata?.name, configName]);

  const { items: allInstances, loading: instancesLoading } = useAllManagedResources(providerName);

  if (!config && !configError && !crds) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} /><Typography>Loading ProviderConfig…</Typography>
      </Box>
    );
  }
  if (configError) {
    return (
      <Box p={3}>
        <Typography color="error">Failed to load ProviderConfig: {String(configError?.message ?? configError)}</Typography>
      </Box>
    );
  }
  if (!config) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} /><Typography>Loading…</Typography>
      </Box>
    );
  }

  const conditions: any[] = config?.status?.conditions ?? [];
  const failingConditions = conditions.filter((c: any) => c.status === 'False');
  const secretRef = config?.spec?.credentials?.secretRef;
  const credSource = config?.spec?.credentials?.source ?? '';
  const usingInstances = allInstances.filter(
    (item: any) => item.spec?.providerConfigRef?.name === configName
  );

  return (
    <SectionBox
      title={`ProviderConfig: ${configName}`}
      subtitle={`Provider: ${providerName}`}
      headerProps={{ headerStyle: 'main' }}
    >
      {failingConditions.map((c: any) => (
        <Alert key={c.type} severity="error" style={{ marginBottom: 8 }}>
          <strong>{c.type}:</strong> {c.reason} — {c.message}
        </Alert>
      ))}

      <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
        <SectionHeader title="Info" headerStyle="subsection" noPadding />
        <NameValueTable rows={[
          { name: 'Name', value: configName },
          { name: 'Provider', value: providerName },
          { name: 'Scope', value: <ScopeBadge scope="Cluster" /> },
          { name: 'Credentials Source', value: credSource || '—' },
          {
            name: 'Credentials Secret',
            value: secretRef ? `${secretRef.namespace}/${secretRef.name}` : '—',
          },
          {
            name: 'Created',
            value: config?.metadata?.creationTimestamp
              ? new Date(config.metadata.creationTimestamp).toLocaleString() : '—',
          },
        ]} />
      </Paper>

      <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
        <SectionHeader title="Conditions" headerStyle="subsection" noPadding />
        {conditions.length === 0 ? (
          <Typography variant="body2" color="textSecondary">No conditions.</Typography>
        ) : (
          <SimpleTable
            columns={[
              { label: 'Type', getter: (c: any) => c.type },
              {
                label: 'Status', getter: (c: any) => {
                  const ok = c.status === 'True';
                  return <Chip label={c.status} size="small"
                    style={{ background: ok ? xpColors.ready.bg : xpColors.notReady.bg, color: '#fff', fontWeight: 600 }} />;
                }
              },
              { label: 'Reason', getter: (c: any) => c.reason ?? '' },
              { label: 'Message', getter: (c: any) => c.message ?? '', cellProps: { style: { maxWidth: 300 } } },
              {
                label: 'Last Transition', getter: (c: any) =>
                  c.lastTransitionTime ? new Date(c.lastTransitionTime).toLocaleString() : '—'
              },
            ]}
            data={conditions}
          />
        )}
      </Paper>

      <Paper elevation={1} style={{ padding: 16 }}>
        <SectionHeader
          title={
            <>
              Managed Resources using this config
              {!instancesLoading && (
                <Chip label={usingInstances.length} size="small" style={{ marginLeft: 8 }} />
              )}
            </>
          }
          headerStyle="subsection"
          noPadding
        />
        {instancesLoading ? (
          <Box display="flex" alignItems="center" gap={1}>
            <CircularProgress size={16} /><Typography variant="body2">Loading…</Typography>
          </Box>
        ) : usingInstances.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            No managed resources reference this ProviderConfig.
          </Typography>
        ) : (
          <SimpleTable
            columns={[
              { label: 'Kind', getter: (item: any) => item._kind },
              {
                label: 'Name', getter: (item: any) => {
                  const itemName: string = item.metadata?.name ?? '';
                  const ns: string = item.metadata?.namespace ?? '';
                  return (
                    <Box style={{ cursor: 'pointer' }}
                      onClick={() => openManagedDetail({ providerName, group: item._group, plural: item._plural, name: itemName, namespace: ns || undefined })}>
                      <span style={{ color: xpColors.link, textDecoration: 'underline' }}>{itemName}</span>
                    </Box>
                  );
                }
              },
              {
                label: 'Scope', getter: (item: any) => {
                  const ns: string = item.metadata?.namespace ?? '';
                  return <ScopeBadge scope={ns ? 'Namespaced' : 'Cluster'} namespace={ns || undefined} />;
                }
              },
              { label: 'Ready', getter: (item: any) => conditionChip(item.status?.conditions ?? [], 'Ready') },
              { label: 'Synced', getter: (item: any) => conditionChip(item.status?.conditions ?? [], 'Synced') },
              {
                label: 'Age', getter: (item: any) =>
                  item.metadata?.creationTimestamp
                    ? new Date(item.metadata.creationTimestamp).toLocaleDateString() : '—'
              },
            ]}
            data={usingInstances}
          />
        )}
      </Paper>
    </SectionBox>
  );
}

// ── Routed page ───────────────────────────────────────────────────────────────

export default function ProviderConfigDetail() {
  const { providerName, configName } = useParams<{ providerName: string; configName: string }>();
  return <ProviderConfigDetailView providerName={providerName} configName={configName} />;
}
