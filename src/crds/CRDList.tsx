import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { xpColors } from '../common/colors';
import { SchemaPropertyTree } from '../common/CRDSchema';
import { neutralColors } from '../common/crdTheme';
import { ProviderRevision } from '../common/Resources';
import { ScopeBadge } from '../common/ScopeBadge';
import { getApiProxy, NON_MANAGED_PLURALS } from '../helpers';
import { openManagedDetail } from '../managed/ManagedDetail';
import { Provider } from '../providers/provider';

const {
  Typography,
  Box,
  Chip,
  CircularProgress,
  Paper,
  TextField,
  InputAdornment,
  MenuItem,
  Tabs,
  Tab,
} = (window as any).pluginLib?.MuiCore ?? {};
const { SectionBox, SectionHeader, NameValueTable, SimpleTable } =
  (window as any).pluginLib?.CommonComponents ?? {};

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
        <CircularProgress size={14} />
        <Typography variant="body2">Loading…</Typography>
      </Box>
    );
  }
  if (instances.length === 0) {
    return (
      <Box p={2}>
        <Typography variant="body2" color="textSecondary">
          No instances found.
        </Typography>
      </Box>
    );
  }

  return (
    <SimpleTable
      columns={[
        {
          label: 'Name',
          getter: (inst: any) => {
            const instName: string = inst.metadata?.name ?? '';
            const ns: string = inst.metadata?.namespace ?? '';
            return (
              <Box
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  openManagedDetail({
                    providerName,
                    group,
                    plural,
                    name: instName,
                    namespace: ns || undefined,
                  })
                }
              >
                <span style={{ color: xpColors.link, textDecoration: 'underline' }}>
                  {instName}
                </span>
                {ns && (
                  <Typography variant="caption" color="textSecondary" style={{ marginLeft: 6 }}>
                    {ns}
                  </Typography>
                )}
              </Box>
            );
          },
        },
        {
          label: 'Ready',
          getter: (inst: any) => {
            const ready = inst.status?.conditions?.find((c: any) => c.type === 'Ready');
            return ready ? (
              <Chip
                label={ready.status === 'True' ? 'Ready' : 'Not Ready'}
                size="small"
                style={{
                  background: ready.status === 'True' ? xpColors.ready.bg : xpColors.notReady.bg,
                  color: '#fff',
                  fontWeight: 600,
                }}
              />
            ) : (
              <Chip label="—" size="small" />
            );
          },
        },
        {
          label: 'Synced',
          getter: (inst: any) => {
            const synced = inst.status?.conditions?.find((c: any) => c.type === 'Synced');
            return synced ? (
              <Chip
                label={synced.status === 'True' ? 'Synced' : 'Not Synced'}
                size="small"
                style={{
                  background: synced.status === 'True' ? xpColors.synced.bg : xpColors.notSynced.bg,
                  color: '#fff',
                  fontWeight: 600,
                }}
              />
            ) : (
              <Chip label="—" size="small" />
            );
          },
        },
        {
          label: 'Age',
          getter: (inst: any) =>
            inst.metadata?.creationTimestamp
              ? new Date(inst.metadata.creationTimestamp).toLocaleDateString()
              : '—',
        },
      ]}
      data={instances}
    />
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

  const tabs = ['Health', 'Schema'];
  if (isManagedResource) {
    tabs.push(instanceCount !== null ? `Resources (${instanceCount})` : 'Resources');
  }

  return (
    <SectionBox title={kind} subtitle={group} headerProps={{ headerStyle: 'main' }}>
      <Tabs value={tab} onChange={(_: any, v: number) => setTab(v)} style={{ marginBottom: 24 }}>
        {tabs.map(label => (
          <Tab key={label} label={label} />
        ))}
      </Tabs>

      {tab === 0 && (
        <>
          <Paper elevation={1} style={{ padding: 16, marginBottom: 16 }}>
            {description && (
              <Typography
                variant="body2"
                color="textSecondary"
                style={{ lineHeight: 1.6, marginBottom: 16 }}
              >
                {description}
              </Typography>
            )}
            <NameValueTable
              rows={[
                { name: 'Group', value: group },
                { name: 'Version', value: versions.map((v: any) => v.name).join(', ') },
                { name: 'Scope', value: <ScopeBadge scope={scope} /> },
                { name: 'Provider', value: providerName },
              ]}
            />
          </Paper>
        </>
      )}

      {tab === 1 && (
        <Paper elevation={1} style={{ padding: 16 }}>
          <SectionHeader title="OpenAPI Schema" headerStyle="subsection" noPadding />
          {openAPISchema ? (
            <Box mt={1}>
              <SchemaPropertyTree schema={openAPISchema} required={openAPISchema.required ?? []} />
            </Box>
          ) : (
            <Typography variant="body2" color="textSecondary">
              No schema available.
            </Typography>
          )}
        </Paper>
      )}

      {tab === 2 && isManagedResource && (
        <Paper elevation={1} style={{ padding: 0 }}>
          <InstancesList crd={crd} providerName={providerName} />
        </Paper>
      )}
    </SectionBox>
  );
}

// ── Activity launchers ────────────────────────────────────────────────────────

function openCRDDetail(crd: any, providerName: string) {
  const Activity = (window as any).pluginLib?.Activity;
  if (!Activity?.launch) return;
  const kind: string = crd.jsonData?.spec?.names?.kind ?? crd.metadata.name;
  Activity.launch({
    id: `crd-detail:${crd.metadata.name}`,
    location: 'split-left',
    temporary: true,
    title: `CRD · ${kind}`,
    content: <CRDDetailView crd={crd} providerName={providerName} />,
  });
}

export function openCRDDetailByGroupPlural(group: string, plural: string, providerName: string) {
  getApiProxy()
    .request(`/apis/apiextensions.k8s.io/v1/customresourcedefinitions`, { isJSON: true })
    .then((res: any) => {
      const crdObj = (res?.items ?? []).find(
        (c: any) => c.spec?.group === group && c.spec?.names?.plural === plural
      );
      if (!crdObj) return;
      openCRDDetail({ metadata: { name: crdObj.metadata.name }, jsonData: crdObj }, providerName);
    })
    .catch(() => {
      /* silently ignore */
    });
}

// ── CRD row ───────────────────────────────────────────────────────────────────

function CRDRow({ crd, providerName }: { crd: any; providerName: string }) {
  const kind: string = crd.jsonData?.spec?.names?.kind ?? crd.metadata.name;
  const group: string = crd.jsonData?.spec?.group ?? '';
  const scope: string = crd.jsonData?.spec?.scope ?? '';
  const topVersion: string = crd.jsonData?.spec?.versions?.[0]?.name ?? '';
  const neutral = neutralColors();

  return (
    <tr
      style={{ borderBottom: `1px solid ${neutral.borderSubtle}`, cursor: 'pointer' }}
      onClick={() => openCRDDetail(crd, providerName)}
    >
      <td style={{ padding: '8px 12px' }}>
        <span style={{ color: xpColors.link, textDecoration: 'underline', fontWeight: 600 }}>
          {kind}
        </span>
      </td>
      <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{group}</td>
      <td style={{ padding: '8px 12px' }}>{topVersion}</td>
      <td style={{ padding: '8px 12px' }}>
        <ScopeBadge scope={scope} />
      </td>
    </tr>
  );
}

// ── CRD detail page (routed) ──────────────────────────────────────────────────

export function CRDDetail() {
  const location = useLocation();
  const params = new URLSearchParams(
    location.search.startsWith('?') ? location.search.slice(1) : location.search
  );
  const crdName = params.get('crd') ?? '';
  const providerName = params.get('provider') ?? '—';
  const [crd, setCrd] = useState<any>(null);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    if (!crdName) return;
    getApiProxy()
      .request(`/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${crdName}`, {
        isJSON: true,
      })
      .then((raw: any) => setCrd({ metadata: raw.metadata, jsonData: raw }))
      .catch((e: any) => setError(e));
  }, [crdName]);

  if (error)
    return (
      <Box p={3}>
        <Typography color="error">Failed to load CRD: {String(error?.message ?? error)}</Typography>
      </Box>
    );
  if (!crd)
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading…</Typography>
      </Box>
    );

  return <CRDDetailView crd={crd} providerName={providerName} />;
}

// ── Group section ─────────────────────────────────────────────────────────────

function GroupSection({
  label,
  crds,
  providerMap,
}: {
  label: string;
  crds: any[];
  providerMap: Map<string, string>;
}) {
  const [open, setOpen] = useState(true);
  const neutral = neutralColors();

  return (
    <Paper elevation={1} style={{ marginBottom: 16 }}>
      <Box
        px={2}
        py={1.5}
        borderBottom={open ? `1px solid ${neutral.border}` : 'none'}
        display="flex"
        alignItems="center"
        gap={1}
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen(v => !v)}
      >
        <span style={{ fontSize: 11, color: neutral.muted, userSelect: 'none' as const }}>
          {open ? '▾' : '▸'}
        </span>
        <Typography variant="subtitle1" style={{ fontWeight: 600 }}>
          {label}
        </Typography>
        <Chip label={crds.length} size="small" style={{ marginLeft: 4 }} />
      </Box>
      {open && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr
              style={{
                borderBottom: `2px solid ${neutral.border}`,
                textAlign: 'left',
                background: neutral.surface,
              }}
            >
              {['Kind', 'Group', 'Version', 'Scope'].map(h => (
                <th key={h} style={{ padding: '8px 12px', fontWeight: 600 }}>
                  {h}
                </th>
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
  const location = useLocation();
  const history = useHistory();
  const qp = new URLSearchParams(
    location.search.startsWith('?') ? location.search.slice(1) : location.search
  );

  const [allCrds] = K8s.ResourceClasses.CustomResourceDefinition.useList();
  const providerMap = useCRDProviderMap();

  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'Cluster' | 'Namespaced'>('all');
  const [providerFilter, setProviderFilter] = useState(qp.get('provider') ?? 'all');
  const [groupBy, setGroupBy] = useState<GroupBy>('provider');

  useEffect(() => {
    const p = new URLSearchParams(
      location.search.startsWith('?') ? location.search.slice(1) : location.search
    );
    setProviderFilter(p.get('provider') ?? 'all');
  }, [location.search]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (providerFilter !== 'all') params.set('provider', providerFilter);
    const newSearch = params.toString() ? `?${params.toString()}` : '';
    if (location.search !== newSearch) {
      history.replace({ ...location, search: newSearch });
    }
  }, [providerFilter]);

  const providerCrds = (allCrds ?? []).filter((crd: any) => providerMap.has(crd.metadata.name));
  const providerNames = Array.from(new Set(Array.from(providerMap.values()))).sort();
  const neutral = neutralColors();

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
        <CircularProgress size={20} />
        <Typography>Loading CRDs…</Typography>
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
    groupedSections = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, crds]) => ({ label, crds }));
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
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ opacity: 0.45 }}
                    >
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </InputAdornment>
                ),
              }}
              style={{ width: 200 }}
            />
            <TextField
              select
              size="small"
              value={scopeFilter}
              onChange={(e: any) => setScopeFilter(e.target.value)}
              style={{ width: 140 }}
            >
              <MenuItem value="all">All scopes</MenuItem>
              <MenuItem value="Cluster">Cluster</MenuItem>
              <MenuItem value="Namespaced">Namespaced</MenuItem>
            </TextField>
            {providerNames.length > 0 && (
              <TextField
                select
                size="small"
                value={providerFilter}
                onChange={(e: any) => setProviderFilter(e.target.value)}
                style={{ width: 180 }}
              >
                <MenuItem value="all">All providers</MenuItem>
                {providerNames.map(n => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              select
              size="small"
              value={groupBy}
              onChange={(e: any) => setGroupBy(e.target.value as GroupBy)}
              style={{ width: 160 }}
            >
              <MenuItem value="provider">Group by provider</MenuItem>
              <MenuItem value="group">Group by API group</MenuItem>
              <MenuItem value="none">No grouping</MenuItem>
            </TextField>
          </Box>,
        ],
      }}
    >
      {(providerFilter !== 'all' || scopeFilter !== 'all' || search) && (
        <Box mb={1.5} display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <Typography variant="caption" color="textSecondary">
            Filtered:
          </Typography>
          {providerFilter !== 'all' && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: xpColors.link,
                color: '#fff',
                borderRadius: 10,
                padding: '2px 10px',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {providerFilter}
              <button
                type="button"
                style={{
                  cursor: 'pointer',
                  opacity: 0.8,
                  marginLeft: 2,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'inherit',
                  fontSize: 'inherit',
                }}
                onClick={() => setProviderFilter('all')}
              >
                ×
              </button>
            </span>
          )}
          {scopeFilter !== 'all' && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: '#616161',
                color: '#fff',
                borderRadius: 10,
                padding: '2px 10px',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {scopeFilter}
              <button
                type="button"
                style={{
                  cursor: 'pointer',
                  opacity: 0.8,
                  marginLeft: 2,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'inherit',
                  fontSize: 'inherit',
                }}
                onClick={() => setScopeFilter('all')}
              >
                ×
              </button>
            </span>
          )}
          {search && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: '#616161',
                color: '#fff',
                borderRadius: 10,
                padding: '2px 10px',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              "{search}"
              <button
                type="button"
                style={{
                  cursor: 'pointer',
                  opacity: 0.8,
                  marginLeft: 2,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'inherit',
                  fontSize: 'inherit',
                }}
                onClick={() => setSearch('')}
              >
                ×
              </button>
            </span>
          )}
        </Box>
      )}

      {sorted.length === 0 ? (
        <Typography color="textSecondary">No CRDs match the current filter.</Typography>
      ) : groupBy === 'none' ? (
        <Paper elevation={1}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  borderBottom: `2px solid ${neutral.border}`,
                  textAlign: 'left',
                  background: neutral.surface,
                }}
              >
                {['Kind', 'Group', 'Version', 'Scope'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', fontWeight: 600 }}>
                    {h}
                  </th>
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
