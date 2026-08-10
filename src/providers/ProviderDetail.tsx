import { useEffect, useState } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { useCRDsForProvider, useAllManagedResources, clusterPrefix, getApiProxy, NON_MANAGED_PLURALS } from '../helpers';
import { xpColors } from '../common/colors';
import { ScopeBadge } from '../common/ScopeBadge';
import { YamlEditor } from '../common/YamlEditor';
import { openManagedDetail } from '../managed/ManagedDetail';

const { Typography, Box, Chip, CircularProgress, Button, Paper, Tabs, Tab, Alert } =
  (window as any).pluginLib?.MuiCore ?? {};
const { SectionBox, SectionHeader } = (window as any).pluginLib?.CommonComponents ?? {};

function ConditionRow({ cond }: { cond: any }) {
  const ok = cond.status === 'True';
  return (
    <tr style={{ borderBottom: '1px solid #f5f5f5' }}>
      <td style={{ padding: '6px 12px', fontWeight: 600 }}>{cond.type}</td>
      <td style={{ padding: '6px 12px' }}>
        <Chip
          label={cond.status}
          size="small"
          style={{ background: ok ? xpColors.ready.bg : xpColors.notReady.bg, color: '#fff', fontWeight: 600 }}
        />
      </td>
      <td style={{ padding: '6px 12px', fontSize: 12, color: '#666' }}>{cond.reason ?? ''}</td>
      <td style={{ padding: '6px 12px', fontSize: 12, color: '#666' }}>{cond.message ?? ''}</td>
    </tr>
  );
}

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
  const history = useHistory();
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
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left', background: '#fafafa' }}>
          {['Name', 'Credentials', 'Actions'].map((h) => (
            <th key={h} style={{ padding: '8px 12px', fontWeight: 600, fontSize: 13 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {configs.map((cfg: any) => {
          const cfgName: string = cfg.metadata?.name ?? '';
          const secretRef = cfg.spec?.credentials?.secretRef;
          const credLabel = secretRef
            ? `${secretRef.namespace}/${secretRef.name}`
            : cfg.spec?.credentials?.source ?? '—';
          return (
            <tr key={cfgName} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '8px 12px', fontWeight: 600 }}>{cfgName}</td>
              <td style={{ padding: '8px 12px', fontSize: 13, fontFamily: 'monospace' }}>{credLabel}</td>
              <td style={{ padding: '8px 12px' }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() =>
                    history.push(
                      `${clusterPrefix()}/crossplane/providers/${providerName}/providerconfigs/${cfgName}`
                    )
                  }
                >
                  View
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left', background: '#fafafa' }}>
          {['Kind', 'Name', 'Ready', 'Synced', 'Age'].map((h) => (
            <th key={h} style={{ padding: '8px 12px', fontWeight: 600, fontSize: 13 }}>{h}</th>
          ))}
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
              key={`${item._group}/${item._plural}/${ns}/${itemName}`}
              style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
              onClick={() => openManagedDetail({ providerName, group: item._group, plural: item._plural, name: itemName, namespace: ns || undefined })}
            >
              <td style={{ padding: '8px 12px', fontWeight: 600 }}>{item._kind}</td>
              <td style={{ padding: '8px 12px' }}>
                <span style={{ color: xpColors.link, textDecoration: 'underline' }}>{itemName}</span>
                {ns && (
                  <Typography variant="caption" display="block" color="textSecondary">{ns}</Typography>
                )}
              </td>
              <td style={{ padding: '8px 12px' }}>{conditionChip(conditions, 'Ready')}</td>
              <td style={{ padding: '8px 12px' }}>{conditionChip(conditions, 'Synced')}</td>
              <td style={{ padding: '8px 12px', fontSize: 12 }}>{created}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function ProviderDetail() {
  const { name } = useParams<{ name: string }>();
  const [tab, setTab] = useState(0);
  const [providers, error] = Provider.useList();

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
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['Package', packageRef],
                  ['Current Revision', currentRevision],
                  ['Controller', controllerRef],
                  [
                    'Created',
                    provider.metadata?.creationTimestamp
                      ? new Date(provider.metadata.creationTimestamp).toLocaleString()
                      : '—',
                  ],
                ].map(([label, value]) => (
                  <tr key={label} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '6px 12px', fontWeight: 600, width: 180 }}>{label}</td>
                    <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 13 }}>
                      {value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Paper>

          {/* Conditions */}
          <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
            <SectionHeader title="Conditions" headerStyle="subsection" noPadding />
            {conditions.length === 0 ? (
              <Typography variant="body2" color="textSecondary">No conditions reported.</Typography>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                    {['Type', 'Status', 'Reason', 'Message'].map((h) => (
                      <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {conditions.map((c: any) => (
                    <ConditionRow key={c.type} cond={c} />
                  ))}
                </tbody>
              </table>
            )}
          </Paper>

          {/* Provider Configs */}
          <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
            <SectionHeader title="Provider Configs" headerStyle="subsection" noPadding />
            <ProviderConfigsSection providerName={name} currentRevision={currentRevision} />
          </Paper>

          {/* Managed Resource Types */}
          <Paper elevation={1} style={{ padding: 16 }}>
            <SectionHeader title="Managed Resource Types" headerStyle="subsection" noPadding />
            <ManagedResourceSection providerName={name} currentRevision={currentRevision} />
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
