import { useEffect, useState } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { getApiProxy } from '../helpers';

const { Typography, Box, Chip, CircularProgress, Paper, Button } =
  (window as any).pluginLib?.MuiCore ?? {};

function useCustomResource(
  group: string,
  plural: string,
  name: string,
  namespace?: string
) {
  const [item, setItem] = useState<any>(null);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    if (!group || !plural || !name) return;
    const nsPath = namespace ? `namespaces/${namespace}/` : '';
    // Try versions in order
    const tryVersions = ['v1alpha1', 'v1beta1', 'v1'];
    let cancelled = false;

    async function tryFetch() {
      for (const ver of tryVersions) {
        try {
          const url = `/apis/${group}/${ver}/${nsPath}${plural}/${name}`;
          const res = await getApiProxy().request(url, { isJSON: true });
          if (!cancelled) { setItem(res); return; }
        } catch (e: any) {
          if (e?.status === 404) continue;
          if (!cancelled) { setError(e); return; }
        }
      }
      if (!cancelled) setError(new Error(`Resource ${name} not found in any version`));
    }
    tryFetch();
    return () => { cancelled = true; };
  }, [group, plural, name, namespace]);

  return [item, error] as const;
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
            <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600 }}>
              {h}
            </th>
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
                {c.lastTransitionTime
                  ? new Date(c.lastTransitionTime).toLocaleString()
                  : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ProviderPodSection({
  providerName,
  cluster,
}: {
  providerName: string;
  cluster: string;
}) {
  const history = useHistory();
  const [pods] = K8s.ResourceClasses.Pod.useList({ namespace: 'crossplane-system' });

  const providerPod = pods?.find(
    (pod: any) =>
      pod.metadata?.labels?.['pkg.crossplane.io/revision']?.includes(providerName) ||
      pod.metadata?.name?.includes(providerName)
  );

  if (!pods) return <CircularProgress size={16} />;
  if (!providerPod) {
    return (
      <Typography variant="body2" color="textSecondary">
        No provider pod found for {providerName} in crossplane-system namespace.
      </Typography>
    );
  }

  const podName = providerPod.metadata?.name ?? '';
  const podNs = providerPod.metadata?.namespace ?? 'crossplane-system';

  return (
    <Box display="flex" alignItems="center" gap={2}>
      <Typography variant="body2">
        Provider pod: <strong>{podName}</strong>
      </Typography>
      <Button
        size="small"
        variant="contained"
        onClick={() => history.push(`/c/${cluster}/pods/${podNs}/${podName}/logs`)}
      >
        View Logs
      </Button>
    </Box>
  );
}

export default function ManagedDetail() {
  const params = useParams<{
    providerName: string;
    group: string;
    plural: string;
    name: string;
    namespace?: string;
  }>();
  const { providerName, group, plural, name, namespace } = params;

  // Determine cluster name from URL
  const clusterMatch = window.location.pathname.match(/^\/c\/([^/]+)/);
  const cluster = clusterMatch?.[1] ?? 'main';

  const [item, error] = useCustomResource(group, plural, name, namespace);

  if (!item && !error) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading…</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={3}>
        <Typography color="error">
          Failed to load resource: {String(error?.message ?? error)}
        </Typography>
      </Box>
    );
  }

  const conditions: any[] = item?.status?.conditions ?? [];

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        {item?.kind ?? plural}: {name}
      </Typography>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        {group} · {namespace ? `Namespace: ${namespace}` : 'Cluster-scoped'}
      </Typography>

      {/* Info */}
      <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
        <Typography variant="h6" gutterBottom>
          Info
        </Typography>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {[
              ['Name', name],
              ['Namespace', namespace ?? '(cluster-scoped)'],
              ['API Version', item?.apiVersion ?? ''],
              ['Kind', item?.kind ?? ''],
              [
                'Created',
                item?.metadata?.creationTimestamp
                  ? new Date(item.metadata.creationTimestamp).toLocaleString()
                  : '—',
              ],
            ].map(([label, value]) => (
              <tr key={label} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={{ padding: '6px 12px', fontWeight: 600, width: 200 }}>{label}</td>
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
        <Typography variant="h6" gutterBottom>
          Conditions
        </Typography>
        <ConditionTable conditions={conditions} />
      </Paper>

      {/* Provider Pod Logs */}
      <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
        <Typography variant="h6" gutterBottom>
          Provider Pod Logs
        </Typography>
        <ProviderPodSection providerName={providerName} cluster={cluster} />
      </Paper>

      {/* Raw Spec */}
      <Paper elevation={1} style={{ padding: 16 }}>
        <Typography variant="h6" gutterBottom>
          Spec (JSON)
        </Typography>
        <pre
          style={{
            background: '#f5f5f5',
            padding: 12,
            borderRadius: 4,
            overflow: 'auto',
            fontSize: 12,
            maxHeight: 400,
          }}
        >
          {JSON.stringify(item?.spec ?? {}, null, 2)}
        </pre>
      </Paper>
    </Box>
  );
}
