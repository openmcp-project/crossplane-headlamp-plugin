import { useEffect, useState } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { useCRDsForProvider, useAllManagedResources, clusterPrefix, getApiProxy, NON_MANAGED_PLURALS } from '../helpers';
import { xpColors } from '../common/colors';
import { ScopeBadge } from '../common/ScopeBadge';
import { YamlEditor } from '../common/YamlEditor';
import { openManagedDetail } from '../managed/ManagedDetail';
import { openProviderConfigDetail } from '../providerconfigs/ProviderConfigDetail';

const { Typography, Box, Chip, CircularProgress, Button, Paper, Tabs, Tab, Alert } =
  (window as any).pluginLib?.MuiCore ?? {};
const { SectionBox, SectionHeader, NameValueTable, SimpleTable } = (window as any).pluginLib?.CommonComponents ?? {};

// ── Shared props type ─────────────────────────────────────────────────────────

export interface ProviderDetailProps {
  name: string;
}

// ── Activity launcher ─────────────────────────────────────────────────────────

export function openProviderDetail(props: ProviderDetailProps) {
  const Activity = (window as any).pluginLib?.Activity;
  if (!Activity?.launch) {
    console.warn('Activity.launch not available in this version of Headlamp');
    return;
  }
  Activity.launch({
    id: `provider-detail:${props.name}`,
    location: 'split-right',
    temporary: true,
    title: props.name,
    content: <ProviderDetailView {...props} />,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

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

function ProviderConfigsSection({
  providerName,
  currentRevision,
}: {
  providerName: string;
  currentRevision: string;
}) {
  const [crds] = useCRDsForProvider(providerName, currentRevision);
  const [configs, setConfigs] = useState<any[] | null>(null);

  const configCrd = crds?.find(
    (crd: any) => crd.jsonData?.spec?.names?.plural === 'providerconfigs'
  );

  useEffect(() => {
    if (!configCrd) return;
    const group: string = configCrd.jsonData?.spec?.group ?? '';
    const topVersion: string = configCrd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
    getApiProxy()
      .request(`/apis/${group}/${topVersion}/providerconfigs`, { isJSON: true })
      .then((res: any) => setConfigs(res?.items ?? []))
      .catch(() => setConfigs([]));
  }, [configCrd?.metadata?.name]);

  if (!configCrd) {
    return (
      <Typography variant="body2" color="textSecondary">
        No ProviderConfig CRD found for this provider.
      </Typography>
    );
  }

  if (configs === null) return <CircularProgress size={16} />;
  if (configs.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        No ProviderConfigs found.
      </Typography>
    );
  }

  return (
    <SimpleTable
      columns={[
        { label: 'Name', getter: (cfg: any) => cfg.metadata?.name ?? '' },
        {
          label: 'Credentials', getter: (cfg: any) => {
            const secretRef = cfg.spec?.credentials?.secretRef;
            return secretRef
              ? `${secretRef.namespace}/${secretRef.name}`
              : cfg.spec?.credentials?.source ?? '—';
          }
        },
        {
          label: 'Actions', getter: (cfg: any) => {
            const cfgName: string = cfg.metadata?.name ?? '';
            return (
              <Button size="small" variant="outlined"
                onClick={() => openProviderConfigDetail({ providerName, configName: cfgName })}>
                View
              </Button>
            );
          }
        },
      ]}
      data={configs}
    />
  );
}

function ManagedResourceSection({
  providerName,
  currentRevision,
}: {
  providerName: string;
  currentRevision: string;
}) {
  const history = useHistory();
  const [crds, error] = useCRDsForProvider(providerName, currentRevision);

  if (!currentRevision) return null;
  if (!crds && !error) return <CircularProgress size={16} />;
  if (error) return <Typography color="error">Error loading CRDs</Typography>;
  if (!crds || crds.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        No managed resource CRDs found.
      </Typography>
    );
  }

  return (
    <Box>
      {crds.map((crd: any) => {
        const crdGroup = crd.jsonData?.spec?.group ?? '';
        const plural = crd.jsonData?.spec?.names?.plural ?? '';
        const kind = crd.jsonData?.spec?.names?.kind ?? '';
        const scope = crd.jsonData?.spec?.scope ?? '';
        if (NON_MANAGED_PLURALS.has(plural)) return null;
        return (
          <Box
            key={crd.metadata.name}
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            py={1}
            borderBottom="1px solid #f0f0f0"
          >
            <Box>
              <Typography variant="body1" fontWeight={600}>
                {kind}
              </Typography>
              <Typography variant="body2" color="textSecondary" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{crd.metadata.name}</span>
                <ScopeBadge scope={scope} />
              </Typography>
            </Box>
            <Button
              size="small"
              variant="outlined"
              onClick={() =>
                history.push(
                  `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${crdGroup}/${plural}`
                )
              }
            >
              Browse
            </Button>
          </Box>
        );
      })}
    </Box>
  );
}

function AllInstancesTab({ providerName }: { providerName: string }) {
  const { items, loading } = useAllManagedResources(providerName);

  if (loading) {
    return (
      <Box p={2} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading instances…</Typography>
      </Box>
    );
  }

  if (items.length === 0) {
    return (
      <Box p={2}>
        <Typography variant="body2" color="textSecondary">No instances found.</Typography>
      </Box>
    );
  }

  return (
    <SimpleTable
      columns={[
        { label: 'Kind', getter: (item: any) => item._kind },
        {
          label: 'Name', getter: (item: any) => {
            const itemName: string = item.metadata?.name ?? '';
            const ns: string = item.metadata?.namespace ?? '';
            return (
              <Box>
                <span style={{ color: xpColors.link, textDecoration: 'underline' }}>{itemName}</span>
                {ns && <Typography variant="caption" display="block" color="textSecondary">{ns}</Typography>}
              </Box>
            );
          }
        },
        { label: 'Ready', getter: (item: any) => conditionChip(item.status?.conditions ?? [], 'Ready') },
        { label: 'Synced', getter: (item: any) => conditionChip(item.status?.conditions ?? [], 'Synced') },
        {
          label: 'Age', getter: (item: any) =>
            item.metadata?.creationTimestamp
              ? new Date(item.metadata.creationTimestamp).toLocaleDateString()
              : '—'
        },
      ]}
      data={items}
    />
  );
}

export function ProviderDetailView({ name }: ProviderDetailProps) {
  const [tab, setTab] = useState(0);
  const [providers, error] = Provider.useList();
  const history = useHistory();

  if (!providers && !error) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading…</Typography>
      </Box>
    );
  }

  const provider = providers?.find((p: any) => p.metadata.name === name);

  if (!provider) {
    return (
      <Box p={3}>
        <Typography color="error">Provider "{name}" not found.</Typography>
      </Box>
    );
  }

  const conditions: any[] = provider.jsonData?.status?.conditions ?? [];
  const packageRef: string = provider.jsonData?.spec?.package ?? '';
  const currentRevision: string = provider.jsonData?.status?.currentRevision ?? '';
  const controllerRef = provider.jsonData?.status?.controller?.configRef?.name ?? '';
  const labels: Record<string, string> = provider.jsonData?.metadata?.labels ?? provider.metadata?.labels ?? {};
  const isManagedByPlatform = 'controlplane.core.orchestrate.cloud.sap/component' in labels;

  const hasError = conditions.some((c: any) => c.status === 'False');

  return (
    <SectionBox title={`Provider: ${name}`} headerProps={{ headerStyle: 'main' }}>
      {hasError && (
        <Alert severity="error" style={{ marginBottom: 16 }}>
          {conditions.filter((c: any) => c.status === 'False').map((c: any) => (
            <div key={c.type}>
              <strong>{c.type}:</strong> {c.reason} — {c.message}
            </div>
          ))}
        </Alert>
      )}

      <Tabs value={tab} onChange={(_: any, v: number) => setTab(v)} style={{ marginBottom: 24 }}>
        <Tab label="Overview" />
        <Tab label="All Instances" />
        <Tab label="YAML" />
      </Tabs>

      {tab === 0 && (
        <>
          {/* Basic Info */}
          <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
            <SectionHeader title="Provider Info" headerStyle="subsection" noPadding />
            <NameValueTable rows={[
              { name: 'Package', value: packageRef },
              { name: 'Current Revision', value: currentRevision },
              { name: 'Controller', value: controllerRef },
              {
                name: 'Created',
                value: provider.metadata?.creationTimestamp
                  ? new Date(provider.metadata.creationTimestamp).toLocaleString()
                  : '—',
              },
              {
                name: 'Installation',
                value: isManagedByPlatform ? (
                  <span style={{ padding: '2px 10px', borderRadius: 10, background: '#1565c0', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                    Managed by Platform
                  </span>
                ) : (
                  <span style={{ padding: '2px 10px', borderRadius: 10, background: '#546e7a', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                    Manually Installed
                  </span>
                ),
              },
            ]} />
          </Paper>

          {/* Conditions */}
          <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
            <SectionHeader title="Conditions" headerStyle="subsection" noPadding />
            {conditions.length === 0 ? (
              <Typography variant="body2" color="textSecondary">No conditions reported.</Typography>
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
                  { label: 'Message', getter: (c: any) => c.message ?? '' },
                ]}
                data={conditions}
              />
            )}
          </Paper>

          {/* Provider Configs */}
          <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
            <SectionHeader title="Provider Configs" headerStyle="subsection" noPadding />
            <ProviderConfigsSection providerName={name} currentRevision={currentRevision} />
          </Paper>

          {/* Quick links */}
          <Paper elevation={1} style={{ padding: 16 }}>
            <SectionHeader title="Explore" headerStyle="subsection" noPadding />
            <Box display="flex" gap={1} mt={1.5}>
              <Button size="small" variant="outlined"
                onClick={() => history.push(`${clusterPrefix()}/crossplane/crds?provider=${name}`)}>
                Show CRDs
              </Button>
              <Button size="small" variant="outlined"
                onClick={() => history.push(`${clusterPrefix()}/crossplane/resources?provider=${name}`)}>
                Show Resources
              </Button>
            </Box>
          </Paper>
        </>
      )}

      {tab === 1 && (
        <Paper elevation={1} style={{ padding: 0 }}>
          <AllInstancesTab providerName={name} />
        </Paper>
      )}

      {tab === 2 && (
        <Box style={{ height: 600 }}>
          <YamlEditor item={provider.jsonData} onSave={async () => {}} readOnly />
        </Box>
      )}
    </SectionBox>
  );
}

// ── Routed page ───────────────────────────────────────────────────────────────

export default function ProviderDetail() {
  const { name } = useParams<{ name: string }>();
  return <ProviderDetailView name={name} />;
}
