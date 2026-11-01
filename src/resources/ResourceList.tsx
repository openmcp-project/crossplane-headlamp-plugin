import { useTheme } from '@mui/material';
import { useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { DOT, xpColors } from '../common/colors';
import { ScopeBadge } from '../common/ScopeBadge';
import { clusterPrefix, getApiProxy, NON_MANAGED_PLURALS, useCRDsForProvider } from '../helpers';
import { Provider } from '../providers/provider';
import styles from './ResourceList.module.css';

const {
  Typography,
  Box,
  Chip,
  CircularProgress,
  Paper,
  FormControlLabel,
  Checkbox,
  TextField,
  InputAdornment,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} = (window as any).pluginLib?.MuiCore ?? {};

// ── URL query helpers ─────────────────────────────────────────────────────────

function parseSearch(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

// ── Status filter types ───────────────────────────────────────────────────────

type StatusFilter = 'all' | 'ready' | 'not-ready' | 'synced' | 'not-synced' | 'needs-attention';

function matchesStatusFilter(item: any, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  const conditions: any[] = item.status?.conditions ?? [];
  const readyStatus = conditions.find((c: any) => c.type === 'Ready')?.status;
  const syncedStatus = conditions.find((c: any) => c.type === 'Synced')?.status;
  if (filter === 'ready') return readyStatus === 'True';
  if (filter === 'not-ready') return readyStatus !== 'True';
  if (filter === 'synced') return syncedStatus === 'True';
  if (filter === 'not-synced') return syncedStatus !== 'True';
  if (filter === 'needs-attention') return readyStatus !== 'True' || syncedStatus !== 'True';
  return true;
}

// ── Label filter helpers ──────────────────────────────────────────────────────

function parseLabelFilter(raw: string): { key: string; value: string | null } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) return { key: trimmed.toLowerCase(), value: null };
  return {
    key: trimmed.slice(0, colonIdx).trim().toLowerCase(),
    value: trimmed
      .slice(colonIdx + 1)
      .trim()
      .toLowerCase(),
  };
}

function matchesLabelFilter(
  labels: Record<string, string>,
  filter: { key: string; value: string | null }
): boolean {
  const entry = Object.entries(labels).find(([k]) => k.toLowerCase().includes(filter.key));
  if (!entry) return false;
  if (filter.value === null) return true;
  return entry[1].toLowerCase().includes(filter.value);
}

function useInstancesForCRD(crd: any, expanded: boolean, statusFilter: StatusFilter) {
  const [instances, setInstances] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!expanded || !crd) return;
    const group: string = crd.jsonData?.spec?.group ?? '';
    const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
    const ver: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
    setLoading(true);
    getApiProxy()
      .request(`/apis/${group}/${ver}/${plural}`, { isJSON: true })
      .then((res: any) => {
        setInstances(res?.items ?? []);
        setLoading(false);
      })
      .catch(() => {
        setInstances([]);
        setLoading(false);
      });
  }, [expanded, crd?.metadata?.name]);

  const filtered = instances ? instances.filter(i => matchesStatusFilter(i, statusFilter)) : null;

  return { instances: filtered, loading };
}

function useCRDInstanceCounts(
  crds: any[] | null
): Map<
  string,
  { total: number; ready: number; notReady: number; synced: number; notSynced: number }
> | null {
  const [counts, setCounts] = useState<Map<
    string,
    { total: number; ready: number; notReady: number; synced: number; notSynced: number }
  > | null>(null);

  useEffect(() => {
    if (!crds) {
      setCounts(null);
      return;
    }
    if (crds.length === 0) {
      setCounts(new Map());
      return;
    }
    let cancelled = false;
    const result = new Map<
      string,
      { total: number; ready: number; notReady: number; synced: number; notSynced: number }
    >();
    const fetches = crds.map((crd: any) => {
      const group: string = crd.jsonData?.spec?.group ?? '';
      const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
      const ver: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
      if (!group || !plural) {
        result.set(crd.metadata.name, { total: 0, ready: 0, notReady: 0, synced: 0, notSynced: 0 });
        return Promise.resolve();
      }
      return getApiProxy()
        .request(`/apis/${group}/${ver}/${plural}`, { isJSON: true })
        .then((res: any) => {
          const items: any[] = res?.items ?? [];
          const ready = items.filter(
            (i: any) =>
              i.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True'
          ).length;
          const synced = items.filter(
            (i: any) =>
              i.status?.conditions?.find((c: any) => c.type === 'Synced')?.status === 'True'
          ).length;
          result.set(crd.metadata.name, {
            total: items.length,
            ready,
            notReady: items.length - ready,
            synced,
            notSynced: items.length - synced,
          });
        })
        .catch(() => {
          result.set(crd.metadata.name, {
            total: 0,
            ready: 0,
            notReady: 0,
            synced: 0,
            notSynced: 0,
          });
        });
    });
    Promise.all(fetches).then(() => {
      if (!cancelled) setCounts(new Map(result));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crds?.map((c: any) => c.metadata.name).join(',')]);

  return counts;
}

// ── Health chips ──────────────────────────────────────────────────────────────

function readyChip(conditions: any[]) {
  const cond = conditions?.find((c: any) => c.type === 'Ready');
  if (!cond) return <Chip label="—" size="small" />;
  const ok = cond.status === 'True';
  return (
    <Chip
      label={ok ? 'Ready' : 'Not Ready'}
      size="small"
      style={{
        background: ok ? xpColors.ready.bg : xpColors.notReady.bg,
        color: '#fff',
        fontWeight: 600,
      }}
    />
  );
}

function syncedChip(conditions: any[]) {
  const cond = conditions?.find((c: any) => c.type === 'Synced');
  if (!cond) return <Chip label="—" size="small" />;
  const ok = cond.status === 'True';
  return (
    <Chip
      label={ok ? 'Synced' : 'Not Synced'}
      size="small"
      style={{
        background: ok ? xpColors.synced.bg : xpColors.notSynced.bg,
        color: '#fff',
        fontWeight: 600,
      }}
    />
  );
}

// ── Expanded instances sub-table ──────────────────────────────────────────────

function InstancesSubTable({
  crd,
  providerName,
  statusFilter,
  labelFilter,
}: {
  crd: any;
  providerName: string;
  statusFilter: StatusFilter;
  labelFilter: string;
}) {
  const history = useHistory();
  const dark = useTheme().palette.mode === 'dark';
  const { instances, loading } = useInstancesForCRD(crd, true, statusFilter);
  const group: string = crd.jsonData?.spec?.group ?? '';
  const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
  const scope: string = crd.jsonData?.spec?.scope ?? 'Cluster';
  const isNamespaced = scope === 'Namespaced';

  const parsedLabel = parseLabelFilter(labelFilter);

  const visibleInstances = instances
    ? parsedLabel
      ? instances.filter((i: any) => matchesLabelFilter(i.metadata?.labels ?? {}, parsedLabel))
      : instances
    : null;

  if (loading) {
    return (
      <tr>
        <td colSpan={8} className={styles.loadingCell}>
          <Box display="flex" alignItems="center" gap={1}>
            <CircularProgress size={14} />
            <Typography variant="body2" color="textSecondary">
              Loading instances…
            </Typography>
          </Box>
        </td>
      </tr>
    );
  }
  if (!visibleInstances || visibleInstances.length === 0) {
    return (
      <tr>
        <td colSpan={8} className={styles.emptyCell}>
          <Typography variant="body2" color="textSecondary">
            {parsedLabel
              ? 'No instances match the label filter.'
              : statusFilter !== 'all'
              ? 'No instances match the current filter.'
              : 'No instances found.'}
          </Typography>
        </td>
      </tr>
    );
  }

  return (
    <>
      {visibleInstances.map((inst: any) => {
        const instName: string = inst.metadata?.name ?? '';
        const ns: string = inst.metadata?.namespace ?? '';
        const conditions: any[] = inst.status?.conditions ?? [];
        const labels: Record<string, string> = inst.metadata?.labels ?? {};
        const created = inst.metadata?.creationTimestamp
          ? new Date(inst.metadata.creationTimestamp).toLocaleDateString()
          : '—';
        const isReady = conditions.find((c: any) => c.type === 'Ready')?.status === 'True';
        const isSynced = conditions.find((c: any) => c.type === 'Synced')?.status === 'True';
        const detailUrl = isNamespaced
          ? `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${group}/${plural}/${ns}/${instName}`
          : `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${group}/${plural}/${instName}`;
        const rowBg = !isReady || !isSynced ? 'rgba(244,67,54,0.04)' : 'transparent';
        return (
          <tr
            key={`${ns}/${instName}`}
            style={{ borderBottom: `1px solid ${dark ? '#333' : '#ebebeb'}`, cursor: 'pointer', background: rowBg }}
            onClick={() => history.push(detailUrl)}
          >
            <td className={styles.instanceChevronCell} />
            <td className={styles.instanceNameCell}>
              <div>
                <span className={styles.instanceName} style={{ color: xpColors.link }}>
                  {instName}
                </span>
              </div>
              {Object.keys(labels).length > 0 && (
                <div className={styles.labelList}>
                  {Object.entries(labels).map(([k, v]) => {
                    const matched = parsedLabel && matchesLabelFilter({ [k]: v }, parsedLabel);
                    return (
                      <span
                        key={k}
                        className={styles.labelChip}
                        style={{
                          background: matched ? '#e3f2fd' : dark ? '#333' : '#f0f0f0',
                          color: matched ? '#1565c0' : dark ? '#bbb' : '#555',
                          border: `1px solid ${matched ? '#90caf9' : dark ? '#555' : '#ddd'}`,
                        }}
                      >
                        {k}: {v}
                      </span>
                    );
                  })}
                </div>
              )}
            </td>
            <td className={styles.instanceEmptyCell} />
            <td className={styles.instanceEmptyCell} />
            <td className={styles.scopeCell}>
              <ScopeBadge scope={scope} namespace={ns} />
            </td>
            <td className={styles.instanceStatusCell}>{readyChip(conditions)}</td>
            <td className={styles.instanceStatusCell}>{syncedChip(conditions)}</td>
            <td className={styles.instanceAgeCell} style={{ color: dark ? '#888' : '#888' }}>
              {created}
            </td>
          </tr>
        );
      })}
    </>
  );
}

// ── Sort types ────────────────────────────────────────────────────────────────

type SortKey = 'kind' | 'group' | 'version' | 'scope' | 'instances';
type SortDir = 'asc' | 'desc';

// ── CRD row ───────────────────────────────────────────────────────────────────

function CRDRow({
  crd,
  providerName,
  count,
  statusFilter,
  labelFilter,
}: {
  crd: any;
  providerName: string;
  count: { total: number; ready: number; notReady: number; synced: number; notSynced: number };
  statusFilter: StatusFilter;
  labelFilter: string;
}) {
  const history = useHistory();
  const dark = useTheme().palette.mode === 'dark';
  const [expanded, setExpanded] = useState(false);

  const group: string = crd.jsonData?.spec?.group ?? '';
  const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
  const kind: string = crd.jsonData?.spec?.names?.kind ?? '';
  const scope: string = crd.jsonData?.spec?.scope ?? '';
  const topVersion: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
  const hasInstances = count.total > 0;

  useEffect(() => {
    if (statusFilter !== 'all' && hasInstances) setExpanded(true);
  }, [statusFilter, hasInstances]);

  return (
    <>
      <tr
        className={styles.crdRow}
        style={{ borderBottom: `1px solid ${dark ? '#333' : '#f0f0f0'}` }}
        onClick={() => {
          if (hasInstances) setExpanded(v => !v);
          else
            history.push(
              `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${group}/${plural}`
            );
        }}
      >
        <td className={styles.chevronCell}>
          {hasInstances ? (
            <span className={styles.chevron}>{expanded ? '▾' : '▸'}</span>
          ) : (
            <span className={styles.chevronSpacer} />
          )}
        </td>
        <td className={styles.kindCell}>
          <span style={{ color: xpColors.link, textDecoration: 'underline' }}>{kind}</span>
        </td>
        <td className={styles.groupCell}>{group}</td>
        <td className={styles.versionCell}>{topVersion}</td>
        <td className={styles.scopeCell}>
          <ScopeBadge scope={scope} />
        </td>
        <td className={styles.statusCell}>
          {hasInstances && count.notReady > 0 ? (
            <Chip
              label={`${count.notReady} not ready`}
              size="small"
              style={{ background: xpColors.notReady.bg, color: '#fff', fontWeight: 600 }}
            />
          ) : hasInstances ? (
            <Chip
              label={`${count.ready} ready`}
              size="small"
              style={{ background: xpColors.ready.bg, color: '#fff', fontWeight: 600 }}
            />
          ) : (
            <span style={{ color: dark ? '#666' : '#bbb', fontSize: 12 }}>—</span>
          )}
        </td>
        <td className={styles.statusCell}>
          {hasInstances && count.notSynced > 0 ? (
            <Chip
              label={`${count.notSynced} not synced`}
              size="small"
              style={{ background: xpColors.notSynced.bg, color: '#fff', fontWeight: 600 }}
            />
          ) : hasInstances ? (
            <Chip
              label={`${count.synced} synced`}
              size="small"
              style={{ background: xpColors.synced.bg, color: '#fff', fontWeight: 600 }}
            />
          ) : (
            <span style={{ color: dark ? '#666' : '#bbb', fontSize: 12 }}>—</span>
          )}
        </td>
        <td className={styles.countCell} style={{ color: dark ? '#aaa' : '#555' }}>
          {hasInstances ? count.total : '—'}
        </td>
      </tr>
      {expanded && (
        <InstancesSubTable
          crd={crd}
          providerName={providerName}
          statusFilter={statusFilter}
          labelFilter={labelFilter}
        />
      )}
    </>
  );
}

// ── Provider section ──────────────────────────────────────────────────────────

function ProviderSection({
  provider,
  hideUnused,
  search,
  sortKey,
  sortDir,
  onSort,
  statusFilter,
  labelFilter,
}: {
  provider: any;
  hideUnused: boolean;
  search: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  statusFilter: StatusFilter;
  labelFilter: string;
}) {
  const dark = useTheme().palette.mode === 'dark';
  const currentRevision: string = provider.jsonData?.status?.currentRevision ?? '';
  const [crds, crdErr] = useCRDsForProvider(provider.metadata.name, currentRevision);
  const counts = useCRDInstanceCounts(
    crds
      ? crds.filter((c: any) => !NON_MANAGED_PLURALS.has(c.jsonData?.spec?.names?.plural ?? ''))
      : null
  );

  const loading = crds === null && !crdErr;
  const countsLoading = hideUnused && crds !== null && counts === null;
  const lc = search.toLowerCase();

  const visibleCrds = (() => {
    if (!crds) return [];
    let list = crds.filter(
      (c: any) => !NON_MANAGED_PLURALS.has(c.jsonData?.spec?.names?.plural ?? '')
    );
    if (hideUnused && counts !== null) {
      list = list.filter((c: any) => (counts.get(c.metadata.name)?.total ?? 0) > 0);
    }
    if (lc) {
      list = list.filter((c: any) => {
        const kind: string = c.jsonData?.spec?.names?.kind ?? '';
        const group: string = c.jsonData?.spec?.group ?? '';
        return kind.toLowerCase().includes(lc) || group.toLowerCase().includes(lc);
      });
    }
    return [...list].sort((a: any, b: any) => {
      let va: any;
      let vb: any;
      if (sortKey === 'kind') {
        va = a.jsonData?.spec?.names?.kind ?? '';
        vb = b.jsonData?.spec?.names?.kind ?? '';
      } else if (sortKey === 'group') {
        va = a.jsonData?.spec?.group ?? '';
        vb = b.jsonData?.spec?.group ?? '';
      } else if (sortKey === 'version') {
        va = a.jsonData?.spec?.versions?.[0]?.name ?? '';
        vb = b.jsonData?.spec?.versions?.[0]?.name ?? '';
      } else if (sortKey === 'scope') {
        va = a.jsonData?.spec?.scope ?? '';
        vb = b.jsonData?.spec?.scope ?? '';
      } else if (sortKey === 'instances') {
        va = counts?.get(a.metadata.name)?.total ?? 0;
        vb = counts?.get(b.metadata.name)?.total ?? 0;
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  })();

  const SortHeader = ({ label, sk }: { label: string; sk: SortKey }) => (
    <th className={styles.sortHeader} onClick={() => onSort(sk)}>
      {label}
      {sortKey === sk && <span className={styles.sortIcon}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  return (
    <Paper elevation={1} style={{ marginBottom: 24 }}>
      <Box
        px={2}
        py={1.5}
        borderBottom={`1px solid ${dark ? '#424242' : '#e0e0e0'}`}
        display="flex"
        alignItems="center"
        gap={1}
      >
        <Typography variant="h6">{provider.metadata.name}</Typography>
        {crds !== null && counts !== null && (
          <Chip label={`${visibleCrds.length} types`} size="small" />
        )}
      </Box>
      {loading || countsLoading ? (
        <Box px={2} py={2} display="flex" alignItems="center" gap={1}>
          <CircularProgress size={16} />
          <Typography variant="body2">Loading…</Typography>
        </Box>
      ) : crdErr ? (
        <Box px={2} py={1.5}>
          <Typography variant="body2" color="error">
            Error loading CRDs
          </Typography>
        </Box>
      ) : visibleCrds.length === 0 ? (
        <Box px={2} py={1.5}>
          <Typography variant="body2" color="textSecondary">
            {lc
              ? 'No types match your search.'
              : hideUnused
              ? 'No resource types with instances.'
              : 'No CRDs found.'}
          </Typography>
        </Box>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr
              style={{
                borderBottom: `2px solid ${dark ? '#424242' : '#e0e0e0'}`,
                textAlign: 'left',
                background: dark ? '#2a2a2a' : '#fafafa',
              }}
            >
              <th className={styles.theadChevron} />
              <SortHeader label="Kind" sk="kind" />
              <SortHeader label="Group" sk="group" />
              <SortHeader label="Version" sk="version" />
              <SortHeader label="Scope" sk="scope" />
              <th className={styles.staticHeader}>Ready</th>
              <th className={styles.staticHeader}>Synced</th>
              <SortHeader label="Age / Count" sk="instances" />
            </tr>
          </thead>
          <tbody>
            {visibleCrds.map((crd: any) => (
              <CRDRow
                key={crd.metadata.name}
                crd={crd}
                providerName={provider.metadata.name}
                count={
                  counts?.get(crd.metadata.name) ?? {
                    total: 0,
                    ready: 0,
                    notReady: 0,
                    synced: 0,
                    notSynced: 0,
                  }
                }
                statusFilter={statusFilter}
                labelFilter={labelFilter}
              />
            ))}
          </tbody>
        </table>
      )}
    </Paper>
  );
}

// ── Main ResourceList ─────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs-attention', label: '⚠ Needs Attention' },
  { value: 'ready', label: 'Ready' },
  { value: 'not-ready', label: 'Not Ready' },
  { value: 'synced', label: 'Synced' },
  { value: 'not-synced', label: 'Not Synced' },
];

export default function ResourceList() {
  const history = useHistory();
  const location = useLocation();
  const [providers, providerErr] = Provider.useList();
  const [hideUnused, setHideUnused] = useState(true);
  const [search, setSearch] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('kind');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const qp = parseSearch(location.search);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    (qp.get('status') as StatusFilter) ?? 'all'
  );
  const [providerFilter, setProviderFilter] = useState<string>(qp.get('provider') ?? 'all');

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (providerFilter !== 'all') params.set('provider', providerFilter);
    const newSearch = params.toString() ? `?${params.toString()}` : '';
    if (location.search !== newSearch) {
      history.replace({ ...location, search: newSearch });
    }
  }, [statusFilter, providerFilter]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  if (!providers && !providerErr) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading providers…</Typography>
      </Box>
    );
  }
  if (providerErr) {
    return (
      <Box p={3}>
        <Typography color="error">Failed to load providers: {String(providerErr)}</Typography>
      </Box>
    );
  }

  const providerNames = (providers ?? []).map((p: any) => p.metadata.name);
  const visibleProviders =
    providerFilter === 'all'
      ? providers ?? []
      : (providers ?? []).filter((p: any) => p.metadata.name === providerFilter);

  const hasActiveFilter = statusFilter !== 'all' || providerFilter !== 'all' || labelFilter !== '';

  return (
    <Box p={3}>
      {hasActiveFilter && (
        <Box mb={2} display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <Typography variant="caption" color="textSecondary">
            Filtered:
          </Typography>
          {statusFilter !== 'all' && (
            <span
              className={styles.filterTag}
              style={{ background: DOT[statusFilter] ?? '#9e9e9e' }}
            >
              {STATUS_OPTIONS.find(o => o.value === statusFilter)?.label}
              <button
                type="button"
                className={styles.filterTagDismiss}
                onClick={() => setStatusFilter('all')}
              >
                ×
              </button>
            </span>
          )}
          {providerFilter !== 'all' && (
            <span className={styles.filterTag} style={{ background: '#616161' }}>
              {providerFilter}
              <button
                type="button"
                className={styles.filterTagDismiss}
                onClick={() => setProviderFilter('all')}
              >
                ×
              </button>
            </span>
          )}
          {labelFilter !== '' && (
            <span className={styles.filterTag} style={{ background: '#1565c0' }}>
              🏷 {labelFilter}
              <button
                type="button"
                className={styles.filterTagDismiss}
                onClick={() => setLabelFilter('')}
              >
                ×
              </button>
            </span>
          )}
        </Box>
      )}

      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        mb={2}
        flexWrap="wrap"
        gap={1}
      >
        <Box>
          <Typography variant="h4">Managed Resources</Typography>
          <Typography variant="body2" color="textSecondary">
            Expand a row to see instances. Sort or filter to find what you need.
          </Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          <TextField
            size="small"
            label="Search"
            placeholder="Kind or group…"
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <span style={{ fontSize: 13, opacity: 0.5 }}>🔍</span>
                </InputAdornment>
              ),
            }}
            style={{ minWidth: 200 }}
          />
          <TextField
            size="small"
            label="Label filter"
            placeholder="e.g. region:eu10"
            value={labelFilter}
            onChange={(e: any) => setLabelFilter(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <span style={{ fontSize: 13, opacity: 0.5 }}>🏷</span>
                </InputAdornment>
              ),
              endAdornment: labelFilter ? (
                <InputAdornment position="end">
                  <button
                    type="button"
                    className={styles.clearFilterBtn}
                    onClick={() => setLabelFilter('')}
                  >
                    ×
                  </button>
                </InputAdornment>
              ) : null,
            }}
            style={{ minWidth: 220 }}
          />
          <FormControl size="small" style={{ minWidth: 160 }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={statusFilter}
              label="Status"
              onChange={(e: any) => setStatusFilter(e.target.value as StatusFilter)}
            >
              {STATUS_OPTIONS.map(o => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {providerNames.length > 1 && (
            <FormControl size="small" style={{ minWidth: 160 }}>
              <InputLabel>Provider</InputLabel>
              <Select
                value={providerFilter}
                label="Provider"
                onChange={(e: any) => setProviderFilter(e.target.value)}
              >
                <MenuItem value="all">All providers</MenuItem>
                {providerNames.map((n: string) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <FormControlLabel
            control={
              <Checkbox
                checked={hideUnused}
                onChange={(e: any) => setHideUnused(e.target.checked)}
                size="small"
              />
            }
            label="Hide unused"
          />
        </Box>
      </Box>

      {visibleProviders.map((p: any) => (
        <ProviderSection
          key={p.metadata.name}
          provider={p}
          hideUnused={hideUnused}
          search={search}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          statusFilter={statusFilter}
          labelFilter={labelFilter}
        />
      ))}
    </Box>
  );
}
