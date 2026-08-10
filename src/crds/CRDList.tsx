import { useEffect, useState } from 'react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Provider, ProviderRevision } from '../common/Resources';
import { getApiProxy, NON_MANAGED_PLURALS } from '../helpers';
import { xpColors } from '../common/colors';
import { ScopeBadge } from '../common/ScopeBadge';
import { YamlEditor } from '../common/YamlEditor';
import { openManagedDetail } from '../managed/ManagedDetail';
import { SchemaPropertyTree, scaffoldFromSchema } from '../common/CRDSchema';
import * as jsYaml from 'js-yaml';

const { Typography, Box, Chip, CircularProgress, Paper, TextField, InputAdornment, MenuItem, Tabs, Tab } =
  (window as any).pluginLib?.MuiCore ?? {};
const { SectionBox, SectionHeader } = (window as any).pluginLib?.CommonComponents ?? {};

// ── CRD → Provider reverse map ────────────────────────────────────────────────

function useCRDProviderMap(): Map<string, string> {
  const [providers] = Provider.useList();
  const [revisions] = ProviderRevision.useList();
  const map = new Map<string, string>();
  if (!providers || !revisions) return map;
  for (const provider of providers) {
    const providerName: string = provider.metadata?.name ?? '';
    const currentRevision: string = provider.jsonData?.status?.currentRevision ?? '';
    const revision = revisions.find((r: any) => r.metadata?.name === currentRevision);
    const refs: any[] = revision?.jsonData?.status?.objectRefs ?? [];
    for (const ref of refs) {
      if (ref.kind === 'CustomResourceDefinition') map.set(ref.name, providerName);
    }
  }
  return map;
}

// ── Instance count fetching ───────────────────────────────────────────────────

function useCRDInstanceCounts(crds: any[] | null) {
  const [counts, setCounts] = useState<Map<string, { total: number; ready: number; notReady: number }> | null>(null);

  useEffect(() => {
    if (!crds) { setCounts(null); return; }
    if (crds.length === 0) { setCounts(new Map()); return; }
    let cancelled = false;
    const result = new Map<string, { total: number; ready: number; notReady: number }>();
    const fetches = crds.map((crd: any) => {
      const group: string = crd.jsonData?.spec?.group ?? '';
      const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
      const ver: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
      if (!group || !plural) { result.set(crd.metadata.name, { total: 0, ready: 0, notReady: 0 }); return Promise.resolve(); }
      return getApiProxy()
        .request(`/apis/${group}/${ver}/${plural}`, { isJSON: true })
        .then((res: any) => {
          const items: any[] = res?.items ?? [];
          const ready = items.filter((i: any) =>
            i.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True'
          ).length;
          result.set(crd.metadata.name, { total: items.length, ready, notReady: items.length - ready });
        })
        .catch(() => { result.set(crd.metadata.name, { total: 0, ready: 0, notReady: 0 }); });
    });
    Promise.all(fetches).then(() => { if (!cancelled) setCounts(new Map(result)); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crds?.map((c: any) => c.metadata.name).join(',')]);

  return counts;
}

// ── Instance health mini-chart ────────────────────────────────────────────────

function InstanceHealthChart({ crd, onResourcesClick }: { crd: any; onResourcesClick?: () => void }) {
  const [counts, setCounts] = useState<{ total: number; ready: number; notReady: number; loading: boolean }>({
    total: 0, ready: 0, notReady: 0, loading: true,
  });

  const group: string = crd.jsonData?.spec?.group ?? '';
  const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
  const ver: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';

  useEffect(() => {
    if (!group || !plural) { setCounts({ total: 0, ready: 0, notReady: 0, loading: false }); return; }
    getApiProxy()
      .request(`/apis/${group}/${ver}/${plural}`, { isJSON: true })
      .then((res: any) => {
        const items: any[] = res?.items ?? [];
        const ready = items.filter((i: any) =>
          i.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True'
        ).length;
        setCounts({ total: items.length, ready, notReady: items.length - ready, loading: false });
      })
      .catch(() => setCounts({ total: 0, ready: 0, notReady: 0, loading: false }));
  }, [crd.metadata.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (counts.loading) return <Box display="flex" alignItems="center" gap={1}><CircularProgress size={14} /><Typography variant="body2" color="textSecondary">Loading…</Typography></Box>;
  if (counts.total === 0) return <Typography variant="body2" color="textSecondary">No instances deployed.</Typography>;

  const readyPct = Math.round((counts.ready / counts.total) * 100);
  const size = 72;
  const r = 28;
  const circ = 2 * Math.PI * r;
  const readyArc = (counts.ready / counts.total) * circ;

  return (
    <Box display="flex" alignItems="center" gap={3}
      onClick={onResourcesClick}
      style={{ cursor: onResourcesClick ? 'pointer' : 'default' }}>
      {/* Donut */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={xpColors.notReady.bg} strokeWidth={10} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={xpColors.ready.bg} strokeWidth={10}
          strokeDasharray={`${readyArc} ${circ - readyArc}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x={size / 2} y={size / 2 + 5} textAnchor="middle"
          style={{ fontSize: 13, fontWeight: 700, fill: readyPct === 100 ? xpColors.ready.bg : xpColors.notReady.bg }}>
          {readyPct}%
        </text>
      </svg>
      {/* Legend */}
      <Box display="flex" flexDirection="column" gap={0.5}>
        <Box display="flex" alignItems="center" gap={1}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: xpColors.ready.bg, flexShrink: 0 }} />
          <Typography variant="body2"><strong>{counts.ready}</strong> Ready</Typography>
        </Box>
        {counts.notReady > 0 && (
          <Box display="flex" alignItems="center" gap={1}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: xpColors.notReady.bg, flexShrink: 0 }} />
            <Typography variant="body2"><strong>{counts.notReady}</strong> Not Ready</Typography>
          </Box>
        )}
        <Typography variant="caption" color="textSecondary">{counts.total} total</Typography>
      </Box>
    </Box>
  );
}

function InstancesList({ crd, providerName }: { crd: any; providerName: string }) {
  const [instances, setInstances] = useState<any[] | null>(null);
  const group: string = crd.jsonData?.spec?.group ?? '';
  const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
  const ver: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';

  useEffect(() => {
    if (!group || !plural) return;
    getApiProxy()
      .request(`/apis/${group}/${ver}/${plural}`, { isJSON: true })
      .then((res: any) => setInstances(res?.items ?? []))
      .catch(() => setInstances([]));
  }, [crd.metadata.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (instances === null) {
    return (
      <Box p={2} display="flex" alignItems="center" gap={1}>
        <CircularProgress size={14} /><Typography variant="body2">Loading…</Typography>
      </Box>
    );
  }
  if (instances.length === 0) {
    return <Box p={2}><Typography variant="body2" color="textSecondary">No instances found.</Typography></Box>;
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left', background: '#fafafa' }}>
          {['Name', 'Ready', 'Synced', 'Age'].map((h) => (
            <th key={h} style={{ padding: '8px 12px', fontWeight: 600, fontSize: 13 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {instances.map((inst: any) => {
          const instName: string = inst.metadata?.name ?? '';
          const ns: string = inst.metadata?.namespace ?? '';
          const conditions: any[] = inst.status?.conditions ?? [];
          const ready = conditions.find((c: any) => c.type === 'Ready');
          const synced = conditions.find((c: any) => c.type === 'Synced');
          const created = inst.metadata?.creationTimestamp
            ? new Date(inst.metadata.creationTimestamp).toLocaleDateString() : '—';
          return (
            <tr key={`${ns}/${instName}`} style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
              onClick={() => openManagedDetail({ providerName, group, plural, name: instName, namespace: ns || undefined })}>
              <td style={{ padding: '8px 12px' }}>
                <span style={{ color: xpColors.link, textDecoration: 'underline' }}>{instName}</span>
                {ns && <span style={{ color: '#888', fontSize: 11, marginLeft: 6 }}>{ns}</span>}
              </td>
              <td style={{ padding: '8px 12px' }}>
                {ready ? (
                  <Chip label={ready.status === 'True' ? 'Ready' : 'Not Ready'} size="small"
                    style={{ background: ready.status === 'True' ? xpColors.ready.bg : xpColors.notReady.bg, color: '#fff', fontWeight: 600 }} />
                ) : <Chip label="—" size="small" />}
              </td>
              <td style={{ padding: '8px 12px' }}>
                {synced ? (
                  <Chip label={synced.status === 'True' ? 'Synced' : 'Not Synced'} size="small"
                    style={{ background: synced.status === 'True' ? xpColors.synced.bg : xpColors.notSynced.bg, color: '#fff', fontWeight: 600 }} />
                ) : <Chip label="—" size="small" />}
              </td>
              <td style={{ padding: '8px 12px', fontSize: 12 }}>{created}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── CRD detail view (Activity panel) ─────────────────────────────────────────

function CRDDetailView({ crd, providerName }: { crd: any; providerName: string }) {
  const [tab, setTab] = useState(0);
  const [instanceCount, setInstanceCount] = useState<number | null>(null);

  const spec = crd.jsonData?.spec ?? {};
  const kind: string = spec.names?.kind ?? crd.metadata.name;
  const group: string = spec.group ?? '';
  const scope: string = spec.scope ?? 'Cluster';
  const versions: any[] = spec.versions ?? [];
  const topVersion = versions[0]?.name ?? '';
  const openAPISchema = versions[0]?.schema?.openAPIV3Schema ?? null;
  const description: string = openAPISchema?.description ?? '';
  const plural: string = spec.names?.plural ?? '';
  const isManagedResource = !NON_MANAGED_PLURALS.has(plural);

  useEffect(() => {
    if (!isManagedResource || !group || !plural) return;
    getApiProxy()
      .request(`/apis/${group}/${topVersion}/${plural}`, { isJSON: true })
      .then((res: any) => setInstanceCount((res?.items ?? []).length))
      .catch(() => setInstanceCount(0));
  }, [crd.metadata.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs = ['Overview', 'Schema'];
  if (isManagedResource) {
    tabs.push(instanceCount !== null ? `Resources (${instanceCount})` : 'Resources');
    tabs.push('Create');
  }

  return (
    <SectionBox title={kind} subtitle={group} headerProps={{ headerStyle: 'main' }}>
      <Box style={{ position: 'relative' }}>
        <span style={{
          position: 'absolute', top: -40, right: 0,
          fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
          padding: '2px 8px', borderRadius: 4,
          background: '#e3f2fd', color: '#1565c0',
          fontFamily: 'monospace', textTransform: 'uppercase' as const,
        }}>CRD Browser</span>
      </Box>
      <Tabs value={tab} onChange={(_: any, v: number) => setTab(v)} style={{ marginBottom: 24 }}>
        {tabs.map((label) => <Tab key={label} label={label} />)}
      </Tabs>

      {/* Overview tab */}
      {tab === 0 && (
        <>
          <Paper elevation={1} style={{ padding: 16, marginBottom: 16 }}>
            {description && (
              <Typography variant="body2" style={{ color: '#555', lineHeight: 1.6, marginBottom: 16 }}>{description}</Typography>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['Group', group],
                  ['Version', versions.map((v: any) => v.name).join(', ')],
                  ['Scope', null],
                  ['Provider', providerName],
                ].map(([label, value]) => (
                  <tr key={label as string} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '6px 12px', fontWeight: 600, width: 160 }}>{label}</td>
                    <td style={{ padding: '6px 12px', fontFamily: value !== null ? 'monospace' : undefined, fontSize: 13 }}>
                      {label === 'Scope' ? <ScopeBadge scope={scope} /> : value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Paper>
        </>
      )}

      {/* Schema tab */}
      {tab === 1 && (
        <Paper elevation={1} style={{ padding: 16 }}>
          <SectionHeader title="OpenAPI Schema" headerStyle="subsection" noPadding />
          {openAPISchema ? (
            <Box mt={1}>
              <SchemaPropertyTree
                schema={openAPISchema}
                required={openAPISchema.required ?? []}
              />
            </Box>
          ) : (
            <Typography variant="body2" color="textSecondary">No schema available.</Typography>
          )}
        </Paper>
      )}

      {/* Resources tab */}
      {tab === 2 && isManagedResource && (
        <Paper elevation={1} style={{ padding: 0 }}>
          <InstancesList crd={crd} providerName={providerName} />
        </Paper>
      )}

      {/* Create tab */}
      {tab === 3 && isManagedResource && (
        <Box style={{ height: 600 }}>
          <YamlEditor
            initialStage="edit"
            item={jsYaml.load(scaffoldFromSchema(kind, group, topVersion, openAPISchema))}
            onSave={async (obj: any) => {
              const isNamespaced = scope === 'Namespaced';
              const ns: string = obj.metadata?.namespace ?? 'default';
              const nsPath = isNamespaced ? `namespaces/${ns}/` : '';
              await getApiProxy().request(`/apis/${group}/${topVersion}/${nsPath}${plural}`, {
                method: 'POST',
                isJSON: true,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(obj),
              });
              setInstanceCount((prev) => (prev ?? 0) + 1);
              setTab(2);
            }}
          />
        </Box>
      )}
    </SectionBox>
  );
}

// ── Activity launcher ─────────────────────────────────────────────────────────

function openCRDDetail(crd: any, providerName: string) {
  const Activity = (window as any).pluginLib?.Activity;
  if (!Activity?.launch) return;
  const kind: string = crd.jsonData?.spec?.names?.kind ?? crd.metadata.name;
  Activity.launch({
    id: `crd-detail:${crd.metadata.name}`,
    location: 'split-right',
    temporary: true,
    title: `CRD · ${kind}`,
    content: <CRDDetailView crd={crd} providerName={providerName} />,
  });
}

export function openCRDDetailByGroupPlural(group: string, plural: string, providerName: string) {
  const crdName = `${plural}.${group}`;
  getApiProxy()
    .request(`/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${crdName}`, { isJSON: true })
    .then((raw: any) => openCRDDetail({ metadata: raw.metadata, jsonData: raw }, providerName))
    .catch((e: any) => console.warn('Could not open CRD detail:', e));
}

// ── CRD row ───────────────────────────────────────────────────────────────────

function CRDRow({ crd, providerName }: {
  crd: any;
  providerName: string;
}) {
  const kind: string = crd.jsonData?.spec?.names?.kind ?? crd.metadata.name;
  const group: string = crd.jsonData?.spec?.group ?? '';
  const scope: string = crd.jsonData?.spec?.scope ?? '';
  const topVersion: string = crd.jsonData?.spec?.versions?.[0]?.name ?? '';

  return (
    <tr style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
      onClick={() => openCRDDetail(crd, providerName)}>
      <td style={{ padding: '8px 12px' }}>
        <span style={{ color: xpColors.link, textDecoration: 'underline', fontWeight: 600 }}>{kind}</span>
      </td>
      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>{group}</td>
      <td style={{ padding: '8px 12px', fontSize: 12 }}>{topVersion}</td>
      <td style={{ padding: '8px 12px' }}><ScopeBadge scope={scope} /></td>
    </tr>
  );
}

// ── Group section ─────────────────────────────────────────────────────────────

function GroupSection({ label, crds, providerMap }: {
  label: string;
  crds: any[];
  providerMap: Map<string, string>;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Paper elevation={1} style={{ marginBottom: 16 }}>
      <Box px={2} py={1.5} borderBottom={open ? '1px solid #e0e0e0' : 'none'}
        display="flex" alignItems="center" gap={1} style={{ cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}>
        <span style={{ fontSize: 11, color: '#888', userSelect: 'none' as const }}>{open ? '▾' : '▸'}</span>
        <Typography variant="subtitle1" style={{ fontWeight: 600 }}>{label}</Typography>
        <Chip label={crds.length} size="small" style={{ marginLeft: 4 }} />
      </Box>
      {open && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left', background: '#fafafa' }}>
              {['Kind', 'Group', 'Version', 'Scope'].map((h) => (
                <th key={h} style={{ padding: '8px 12px', fontWeight: 600, fontSize: 13 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {crds.map((crd: any) => (
              <CRDRow
                key={crd.metadata.name}
                crd={crd}
                providerName={providerMap.get(crd.metadata.name) ?? '—'}
              />
            ))}
          </tbody>
        </table>
      )}
    </Paper>
  );
}

// ── Sort / filter types ───────────────────────────────────────────────────────

type GroupBy = 'provider' | 'group' | 'none';

// ── Main CRDList ──────────────────────────────────────────────────────────────

export default function CRDList() {
  const [allCrds] = K8s.ResourceClasses.CustomResourceDefinition.useList();
  const providerMap = useCRDProviderMap();

  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'Cluster' | 'Namespaced'>('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('provider');

  const providerCrds = (allCrds ?? []).filter((crd: any) => providerMap.has(crd.metadata.name));
  const providerNames = Array.from(new Set(Array.from(providerMap.values()))).sort();

  const lc = search.toLowerCase();
  const filtered = providerCrds.filter((crd: any) => {
    const kind: string = crd.jsonData?.spec?.names?.kind ?? '';
    const group: string = crd.jsonData?.spec?.group ?? '';
    const scope: string = crd.jsonData?.spec?.scope ?? '';
    const prov = providerMap.get(crd.metadata.name) ?? '';
    if (lc && !kind.toLowerCase().includes(lc) && !group.toLowerCase().includes(lc)) return false;
    if (scopeFilter !== 'all' && scope !== scopeFilter) return false;
    if (providerFilter !== 'all' && prov !== providerFilter) return false;
    return true;
  });

  const sorted = [...filtered].sort((a: any, b: any) => {
    const ka: string = a.jsonData?.spec?.names?.kind ?? '';
    const kb: string = b.jsonData?.spec?.names?.kind ?? '';
    return ka.localeCompare(kb);
  });

  if (allCrds === null) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} /><Typography>Loading CRDs…</Typography>
      </Box>
    );
  }

  let groupedSections: { label: string; crds: any[] }[] = [];
  if (groupBy === 'none') {
    groupedSections = [{ label: '', crds: sorted }];
  } else if (groupBy === 'provider') {
    const map = new Map<string, any[]>();
    for (const crd of sorted) {
      const prov = providerMap.get(crd.metadata.name) ?? '—';
      if (!map.has(prov)) map.set(prov, []);
      map.get(prov)!.push(crd);
    }
    groupedSections = Array.from(map.entries()).map(([label, crds]) => ({ label, crds }));
  } else {
    const map = new Map<string, any[]>();
    for (const crd of sorted) {
      const grp: string = crd.jsonData?.spec?.group ?? '—';
      if (!map.has(grp)) map.set(grp, []);
      map.get(grp)!.push(crd);
    }
    groupedSections = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([label, crds]) => ({ label, crds }));
  }

  return (
    <SectionBox
      title="CRDs"
      headerProps={{
        headerStyle: 'main',
        actions: [
          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
            <TextField
              size="small"
              placeholder="Search kind or group…"
              value={search}
              onChange={(e: any) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.45 }}>
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </InputAdornment>
                ),
              }}
              style={{ width: 200 }}
            />
            <TextField select size="small" value={scopeFilter}
              onChange={(e: any) => setScopeFilter(e.target.value)} style={{ width: 140 }}>
              <MenuItem value="all">All scopes</MenuItem>
              <MenuItem value="Cluster">Cluster</MenuItem>
              <MenuItem value="Namespaced">Namespaced</MenuItem>
            </TextField>
            {providerNames.length > 1 && (
              <TextField select size="small" value={providerFilter}
                onChange={(e: any) => setProviderFilter(e.target.value)} style={{ width: 180 }}>
                <MenuItem value="all">All providers</MenuItem>
                {providerNames.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
              </TextField>
            )}
            <TextField select size="small" value={groupBy}
              onChange={(e: any) => setGroupBy(e.target.value as GroupBy)} style={{ width: 160 }}>
              <MenuItem value="provider">Group by provider</MenuItem>
              <MenuItem value="group">Group by API group</MenuItem>
              <MenuItem value="none">No grouping</MenuItem>
            </TextField>
          </Box>,
        ],
      }}
    >
      <Typography variant="caption" color="textSecondary" style={{ display: 'block', marginBottom: 12 }}>
        {filtered.length} CRD{filtered.length !== 1 ? 's' : ''} across {providerNames.length} provider{providerNames.length !== 1 ? 's' : ''}
      </Typography>

      {sorted.length === 0 ? (
        <Typography color="textSecondary">No CRDs match the current filter.</Typography>
      ) : groupBy === 'none' ? (
        <Paper elevation={1}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left', background: '#fafafa' }}>
                {['Kind', 'Group', 'Version', 'Scope'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', fontWeight: 600, fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((crd: any) => (
                <CRDRow
                  key={crd.metadata.name}
                  crd={crd}
                  providerName={providerMap.get(crd.metadata.name) ?? '—'}
                />
              ))}
            </tbody>
          </table>
        </Paper>
      ) : (
        groupedSections.map(({ label, crds }) => (
          <GroupSection key={label} label={label} crds={crds} providerMap={providerMap} />
        ))
      )}
    </SectionBox>
  );
}
