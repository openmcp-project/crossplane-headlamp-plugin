import { useEffect, useState } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { getApiProxy, clusterPrefix, detectExternalManager } from '../helpers';

const { Typography, Box, Chip, CircularProgress, Paper, Button, Alert, Accordion, AccordionSummary, AccordionDetails } =
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

const managerColors: Record<string, string> = {
  helm: '#7b1fa2',
  'flux-kustomization': '#00796b',
  'flux-helmrelease': '#00695c',
  argocd: '#e65100',
  kro: '#1565c0',
};

const managerLabels: Record<string, string> = {
  helm: 'Helm',
  'flux-kustomization': 'Flux Kustomization',
  'flux-helmrelease': 'Flux HelmRelease',
  argocd: 'ArgoCD',
  kro: 'Kro',
};

export default function ManagedDetail() {
  const params = useParams<{
    providerName: string;
    group: string;
    plural: string;
    name: string;
    namespace?: string;
  }>();
  const { providerName, group, plural, name, namespace } = params;
  const history = useHistory();

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
  const failingConditions = conditions.filter((c: any) => c.status === 'False');
  const annotations: Record<string, string> = item?.metadata?.annotations ?? {};
  const providerConfigRef: string = item?.spec?.providerConfigRef?.name ?? '';
  const compositeRef: string = annotations['crossplane.io/composite'] ?? '';
  const claimName: string = annotations['crossplane.io/claim-name'] ?? '';
  const claimNamespace: string = annotations['crossplane.io/claim-namespace'] ?? '';
  const atProvider = item?.status?.atProvider;

  const managerInfo = detectExternalManager(item);

  const hasRelationships = !!providerConfigRef || !!compositeRef || !!claimName || managerInfo.manager !== null;

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        {item?.kind ?? plural}: {name}
      </Typography>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        {group} · {namespace ? `Namespace: ${namespace}` : 'Cluster-scoped'}
      </Typography>

      {/* Error banners */}
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

      {/* Relationships */}
      {hasRelationships && (
        <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
            <Typography variant="h6">Relationships</Typography>
          </Box>
          <Box display="flex" flexDirection="column" gap={1}>
            {providerConfigRef && (
              <Box display="flex" alignItems="center" gap={1}>
                <Typography variant="body2" color="textSecondary" style={{ minWidth: 180 }}>
                  ProviderConfig:
                </Typography>
                <span
                  style={{ color: '#1976d2', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}
                  onClick={() =>
                    history.push(
                      `${clusterPrefix()}/crossplane/providers/${providerName}/providerconfigs/${providerConfigRef}`
                    )
                  }
                >
                  {providerConfigRef}
                </span>
              </Box>
            )}
            {compositeRef && (
              <Box display="flex" alignItems="center" gap={1}>
                <Typography variant="body2" color="textSecondary" style={{ minWidth: 180 }}>
                  Composite Resource:
                </Typography>
                <Typography variant="body2" style={{ fontFamily: 'monospace', fontSize: 13 }}>
                  {compositeRef}
                </Typography>
              </Box>
            )}
            {claimName && (
              <Box display="flex" alignItems="center" gap={1}>
                <Typography variant="body2" color="textSecondary" style={{ minWidth: 180 }}>
                  Claim:
                </Typography>
                <Typography variant="body2" style={{ fontFamily: 'monospace', fontSize: 13 }}>
                  {claimNamespace}/{claimName}
                </Typography>
              </Box>
            )}
            {managerInfo.manager && (
              <Box display="flex" alignItems="center" gap={1}>
                <Typography variant="body2" color="textSecondary" style={{ minWidth: 180 }}>
                  Managed by:
                </Typography>
                <span
                  style={{
                    padding: '2px 10px',
                    borderRadius: 10,
                    background: managerColors[managerInfo.manager] ?? '#555',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {managerLabels[managerInfo.manager] ?? managerInfo.manager}
                  {managerInfo.ref ? ` · ${managerInfo.ref}` : ''}
                </span>
              </Box>
            )}
          </Box>
        </Paper>
      )}

      {/* Conditions */}
      <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
        <Typography variant="h6" gutterBottom>Conditions</Typography>
        <ConditionTable conditions={conditions} />
      </Paper>

      {/* Observed State (atProvider) */}
      {atProvider && Object.keys(atProvider).length > 0 && (
        <Accordion style={{ marginBottom: 24 }}>
          <AccordionSummary expandIcon={<span>▾</span>}>
            <Typography variant="h6">Observed State (atProvider)</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <pre
              style={{
                background: '#f5f5f5',
                padding: 12,
                borderRadius: 4,
                overflow: 'auto',
                fontSize: 12,
                maxHeight: 400,
                margin: 0,
              }}
            >
              {JSON.stringify(atProvider, null, 2)}
            </pre>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Raw Spec (collapsed by default) */}
      <Accordion style={{ marginBottom: 24 }}>
        <AccordionSummary expandIcon={<span>▾</span>}>
          <Typography variant="h6">Spec (JSON)</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <pre
            style={{
              background: '#f5f5f5',
              padding: 12,
              borderRadius: 4,
              overflow: 'auto',
              fontSize: 12,
              maxHeight: 400,
              margin: 0,
            }}
          >
            {JSON.stringify(item?.spec ?? {}, null, 2)}
          </pre>
        </AccordionDetails>
      </Accordion>

      {/* Provider Pod Logs — hidden until 404 issue is resolved */}
    </Box>
  );
}
