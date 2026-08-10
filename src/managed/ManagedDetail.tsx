import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import * as jsYaml from 'js-yaml';
import { getApiProxy, detectExternalManager } from '../helpers';
import { xpColors } from '../common/colors';
import { ScopeBadge } from '../common/ScopeBadge';
import { openProviderConfigDetail } from '../providerconfigs/ProviderConfigDetail';

const { Typography, Box, Chip, CircularProgress, Paper, Button, Alert, Tabs, Tab } =
  (window as any).pluginLib?.MuiCore ?? {};
const { SectionBox, SectionHeader, SimpleEditor } = (window as any).pluginLib?.CommonComponents ?? {};

// ── Shared props type ─────────────────────────────────────────────────────────

export interface ManagedDetailProps {
  providerName: string;
  group: string;
  plural: string;
  name: string;
  namespace?: string;
}

// ── Activity launcher ─────────────────────────────────────────────────────────

export function openManagedDetail(props: ManagedDetailProps) {
  const Activity = (window as any).pluginLib?.Activity;
  if (!Activity?.launch) {
    console.warn('Activity.launch not available in this version of Headlamp');
    return;
  }
  const { name, group, plural, namespace } = props;
  const id = `managed-detail:${group}/${plural}/${namespace ?? ''}/${name}`;
  Activity.launch({
    id,
    location: 'split-right',
    temporary: true,
    title: name,
    content: <ManagedDetailView {...props} />,
  });
}

// ── Data hook ─────────────────────────────────────────────────────────────────

function useCustomResource(group: string, plural: string, name: string, namespace?: string) {
  const [item, setItem] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [version, setVersion] = useState<string>('');

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
          if (!cancelled) { setItem(res); setVersion(ver); return; }
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

  return [item, error, version] as const;
}

// ── Sub-components ────────────────────────────────────────────────────────────

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
                <Chip label={c.status} size="small"
                  style={{ background: ok ? xpColors.ready.bg : xpColors.notReady.bg, color: '#fff', fontWeight: 600 }} />
              </td>
              <td style={{ padding: '6px 12px', fontSize: 12 }}>{c.reason ?? ''}</td>
              <td style={{ padding: '6px 12px', fontSize: 12, color: '#555', maxWidth: 300 }}>{c.message ?? ''}</td>
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

function YamlTab({ item, group, plural, name, namespace, version }: {
  item: any; group: string; plural: string; name: string; namespace?: string; version: string;
}) {
  const [yamlValue, setYamlValue] = useState<string>(() => jsYaml.dump(item));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setYamlValue(jsYaml.dump(item));
    setSaveError(null);
    setSaveSuccess(false);
  }, [item]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const parsed = jsYaml.load(yamlValue);
      const nsPath = namespace ? `namespaces/${namespace}/` : '';
      const url = `/apis/${group}/${version}/${nsPath}${plural}/${name}`;
      await getApiProxy().put(url, parsed);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: any) {
      setSaveError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, [yamlValue, group, plural, name, namespace, version]);

  return (
    <Box>
      {saveError && <Alert severity="error" style={{ marginBottom: 12 }}>{saveError}</Alert>}
      {saveSuccess && <Alert severity="success" style={{ marginBottom: 12 }}>Saved successfully.</Alert>}
      <Box style={{ border: '1px solid #e0e0e0', borderRadius: 4, overflow: 'hidden' }}>
        {SimpleEditor ? (
          <SimpleEditor language="yaml" value={yamlValue}
            onChange={(val: string | undefined) => setYamlValue(val ?? '')} />
        ) : (
          <textarea value={yamlValue} onChange={(e) => setYamlValue(e.target.value)}
            style={{ width: '100%', minHeight: 500, fontFamily: 'monospace', fontSize: 12, padding: 12, border: 'none', outline: 'none', resize: 'vertical' }} />
        )}
      </Box>
      <Box mt={1.5} display="flex" justifyContent="flex-end">
        <Button variant="contained" size="small" disabled={saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Box>
    </Box>
  );
}

// ── Core view (props-driven, works in Activity panel OR routed page) ───────────

export function ManagedDetailView({ providerName, group, plural, name, namespace }: ManagedDetailProps) {
  const [tab, setTab] = useState(0);
  const [item, error, version] = useCustomResource(group, plural, name, namespace);

  if (!item && !error) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} /><Typography>Loading…</Typography>
      </Box>
    );
  }
  if (error) {
    return (
      <Box p={3}>
        <Typography color="error">Failed to load resource: {String(error?.message ?? error)}</Typography>
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
  const managerInfo = detectExternalManager(item);
  const hasRelationships = !!providerConfigRef || !!compositeRef || !!claimName || managerInfo.manager !== null;

  return (
    <SectionBox
      title={`${item?.kind ?? plural}: ${name}`}
      subtitle={`${group} · ${namespace ? `Namespace: ${namespace}` : 'Cluster-scoped'}`}
      headerProps={{ headerStyle: 'main' }}
    >
      <Tabs value={tab} onChange={(_: any, v: number) => setTab(v)} style={{ marginBottom: 24 }}>
        <Tab label="Overview" />
        <Tab label="YAML" />
      </Tabs>

      {tab === 0 && (
        <>
          {failingConditions.map((c: any) => (
            <Alert key={c.type} severity="error" style={{ marginBottom: 8 }}>
              <strong>{c.type}:</strong> {c.reason} — {c.message}
            </Alert>
          ))}

          <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
            <SectionHeader title="Info" headerStyle="subsection" noPadding />
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['Name', name],
                  ['API Version', item?.apiVersion ?? ''],
                  ['Kind', item?.kind ?? ''],
                  ['Created', item?.metadata?.creationTimestamp
                    ? new Date(item.metadata.creationTimestamp).toLocaleString() : '—'],
                ].map(([label, value]) => (
                  <tr key={label} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '6px 12px', fontWeight: 600, width: 200 }}>{label}</td>
                    <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 13 }}>{value}</td>
                  </tr>
                ))}
                <tr style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ padding: '6px 12px', fontWeight: 600, width: 200 }}>Scope</td>
                  <td style={{ padding: '6px 12px' }}>
                    <ScopeBadge scope={namespace ? 'Namespaced' : 'Cluster'} namespace={namespace} />
                  </td>
                </tr>
              </tbody>
            </table>
          </Paper>

          {hasRelationships && (
            <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
              <SectionHeader title="Relationships" headerStyle="subsection" noPadding />
              <Box display="flex" flexDirection="column" gap={1} mt={1}>
                {providerConfigRef && (
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="body2" color="textSecondary" style={{ minWidth: 180 }}>ProviderConfig:</Typography>
                    <span style={{ color: xpColors.link, textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}
                      onClick={() => openProviderConfigDetail({ providerName, configName: providerConfigRef })}>
                      {providerConfigRef}
                    </span>
                  </Box>
                )}
                {compositeRef && (
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="body2" color="textSecondary" style={{ minWidth: 180 }}>Composite Resource:</Typography>
                    <Typography variant="body2" style={{ fontFamily: 'monospace', fontSize: 13 }}>{compositeRef}</Typography>
                  </Box>
                )}
                {claimName && (
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="body2" color="textSecondary" style={{ minWidth: 180 }}>Claim:</Typography>
                    <Typography variant="body2" style={{ fontFamily: 'monospace', fontSize: 13 }}>{claimNamespace}/{claimName}</Typography>
                  </Box>
                )}
                {managerInfo.manager && (
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="body2" color="textSecondary" style={{ minWidth: 180 }}>Managed by:</Typography>
                    <span style={{ padding: '2px 10px', borderRadius: 10, background: managerColors[managerInfo.manager] ?? '#555', color: '#fff', fontSize: 12, fontWeight: 600 }}>
                      {managerLabels[managerInfo.manager] ?? managerInfo.manager}
                      {managerInfo.ref ? ` · ${managerInfo.ref}` : ''}
                    </span>
                  </Box>
                )}
              </Box>
            </Paper>
          )}

          <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
            <SectionHeader title="Conditions" headerStyle="subsection" noPadding />
            <ConditionTable conditions={conditions} />
          </Paper>
        </>
      )}

      {tab === 1 && item && (
        <YamlTab item={item} group={group} plural={plural} name={name} namespace={namespace} version={version} />
      )}
    </SectionBox>
  );
}

// ── Routed page (keeps direct URL navigation working) ─────────────────────────

export default function ManagedDetail() {
  const { providerName, group, plural, name, namespace } =
    useParams<{ providerName: string; group: string; plural: string; name: string; namespace?: string }>();
  return <ManagedDetailView providerName={providerName} group={group} plural={plural} name={name} namespace={namespace} />;
}
