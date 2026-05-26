import { useEffect, useState } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import { useCRDsForProvider, useAllManagedResources, getApiProxy, clusterPrefix } from '../helpers';
import { Provider } from '../common/Resources';

const { Typography, Box, Chip, CircularProgress, Paper, Alert } =
  (window as any).pluginLib?.MuiCore ?? {};

function conditionChip(conditions: any[], type: string) {
  const cond = conditions?.find((c: any) => c.type === type);
  if (!cond) return <Chip label="—" size="small" />;
  const ok = cond.status === 'True';
  return (
    <Chip
      label={ok ? type : `Not ${type}`}
      size="small"
      style={{ background: ok ? '#4caf50' : '#f44336', color: '#fff', fontWeight: 600 }}
    />
  );
}

function ConditionTable({ conditions }: { conditions: any[] }) {
  if (!conditions || conditions.length === 0) {
    return <Typography variant="body2" color="textSecondary">No conditions.</Typography>;
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
          {['Type', 'Status', 'Reason', 'Message', 'Last Transition'].map((h) => (
            <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {conditions.map((c: any) => {
          const ok = c.status === 'True';
          return (
            <tr key={c.type} style={{ borderBottom: '1px solid #f5f5f5' }}>
              <td style={{ padding: '6px 12px', fontWeight: 600 }}>{c.type}</td>
              <td style={{ padding: '6px 12px' }}>
                <Chip
                  label={c.status}
                  size="small"
                  style={{ background: ok ? '#4caf50' : '#f44336', color: '#fff', fontWeight: 600 }}
                />
              </td>
              <td style={{ padding: '6px 12px', fontSize: 12 }}>{c.reason ?? ''}</td>
              <td style={{ padding: '6px 12px', fontSize: 12, color: '#555', maxWidth: 300 }}>
                {c.message ?? ''}
              </td>
              <td style={{ padding: '6px 12px', fontSize: 12, color: '#888' }}>
                {c.lastTransitionTime ? new Date(c.lastTransitionTime).toLocaleString() : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function ProviderConfigDetail() {
  const { providerName, configName } = useParams<{
    providerName: string;
    configName: string;
  }>();
  const history = useHistory();

  const [providers] = Provider.useList();
  const provider = providers?.find((p: any) => p.metadata?.name === providerName);
  const currentRevision: string = provider?.jsonData?.status?.currentRevision ?? '';

  const [crds] = useCRDsForProvider(providerName, currentRevision);
  const configCrd = crds?.find(
    (crd: any) => crd.jsonData?.spec?.names?.plural === 'providerconfigs'
  );

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
        <CircularProgress size={20} />
        <Typography>Loading ProviderConfig…</Typography>
      </Box>
    );
  }

  if (configError) {
    return (
      <Box p={3}>
        <Typography color="error">
          Failed to load ProviderConfig: {String(configError?.message ?? configError)}
        </Typography>
      </Box>
    );
  }

  if (!config) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading…</Typography>
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
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        ProviderConfig: {configName}
      </Typography>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        Provider: {providerName}
      </Typography>

      {failingConditions.map((c: any) => (
        <Alert key={c.type} severity="error" style={{ marginBottom: 8 }}>
          <strong>{c.type}:</strong> {c.reason} — {c.message}
        </Alert>
      ))}

      {/* Info */}
      <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
        <Typography variant="h6" gutterBottom>Info</Typography>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {[
              ['Name', configName],
              ['Provider', providerName],
              ['Credentials Source', credSource],
              ['Credentials Secret', secretRef ? `${secretRef.namespace}/${secretRef.name}` : '—'],
              [
                'Created',
                config?.metadata?.creationTimestamp
                  ? new Date(config.metadata.creationTimestamp).toLocaleString()
                  : '—',
              ],
            ].map(([label, value]) => (
              <tr key={label} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={{ padding: '6px 12px', fontWeight: 600, width: 200 }}>{label}</td>
                <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 13 }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Paper>

      {/* Conditions */}
      <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
        <Typography variant="h6" gutterBottom>Conditions</Typography>
        <ConditionTable conditions={conditions} />
      </Paper>

      {/* Managed resources using this config */}
      <Paper elevation={1} style={{ padding: 16 }}>
        <Typography variant="h6" gutterBottom>
          Managed Resources using this config
          {!instancesLoading && (
            <Chip
              label={usingInstances.length}
              size="small"
              style={{ marginLeft: 8 }}
            />
          )}
        </Typography>
        {instancesLoading ? (
          <Box display="flex" alignItems="center" gap={1}>
            <CircularProgress size={16} />
            <Typography variant="body2">Loading…</Typography>
          </Box>
        ) : usingInstances.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            No managed resources reference this ProviderConfig.
          </Typography>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left', background: '#fafafa' }}>
                {['Kind', 'Name', 'Ready', 'Synced', 'Age'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', fontWeight: 600, fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usingInstances.map((item: any) => {
                const itemName: string = item.metadata?.name ?? '';
                const ns: string = item.metadata?.namespace ?? '';
                const conditions2: any[] = item.status?.conditions ?? [];
                const created = item.metadata?.creationTimestamp
                  ? new Date(item.metadata.creationTimestamp).toLocaleDateString()
                  : '—';
                const detailUrl = ns
                  ? `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${item._group}/${item._plural}/${ns}/${itemName}`
                  : `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${item._group}/${item._plural}/${itemName}`;
                return (
                  <tr
                    key={`${item._group}/${item._plural}/${ns}/${itemName}`}
                    style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                    onClick={() => history.push(detailUrl)}
                  >
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{item._kind}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ color: '#1976d2', textDecoration: 'underline' }}>{itemName}</span>
                      {ns && <Typography variant="caption" display="block" color="textSecondary">{ns}</Typography>}
                    </td>
                    <td style={{ padding: '8px 12px' }}>{conditionChip(conditions2, 'Ready')}</td>
                    <td style={{ padding: '8px 12px' }}>{conditionChip(conditions2, 'Synced')}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12 }}>{created}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Paper>
    </Box>
  );
}
