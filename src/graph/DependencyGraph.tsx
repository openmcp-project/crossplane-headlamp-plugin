import { useEffect, useState, useCallback } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { getApiProxy, clusterPrefix } from '../helpers';
import { resourceHealthColor, xpColors } from '../common/colors';

const { Typography, Box, CircularProgress, Paper, Button } =
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
      if (!cancelled) setError(new Error(`Resource ${name} not found`));
    }
    tryFetch();
    return () => { cancelled = true; };
  }, [group, plural, name, namespace]);

  return [item, error] as const;
}

function healthColor(item: any): string {
  const conditions: any[] = item?.status?.conditions ?? [];
  const ready = conditions.find((c: any) => c.type === 'Ready');
  const synced = conditions.find((c: any) => c.type === 'Synced');
  if (ready?.status === 'False' || synced?.status === 'False') return xpColors.degraded.bg;
  if (ready?.status === 'True' && synced?.status === 'True') return xpColors.healthy.bg;
  return xpColors.warning.bg;
}

function nodeStyle(color: string, isClickable = false): React.CSSProperties {
  return {
    background: color,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 18px',
    fontWeight: 600,
    fontSize: 13,
    cursor: isClickable ? 'pointer' : 'default',
    minWidth: 160,
    textAlign: 'center',
    boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
  };
}

export default function DependencyGraph() {
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
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    if (!item) return;

    const annotations: Record<string, string> = item.metadata?.annotations ?? {};
    const providerConfigRef: string = item.spec?.providerConfigRef?.name ?? '';
    const compositeRef: string = annotations['crossplane.io/composite'] ?? '';
    const claimName: string = annotations['crossplane.io/claim-name'] ?? '';
    const claimNamespace: string = annotations['crossplane.io/claim-namespace'] ?? '';

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Layout: vertical chain — Claim (y=0) → XR (y=120) → MR (y=240) → ProviderConfig (y=360)
    const centerX = 300;

    let topY = 0;

    if (claimName) {
      newNodes.push({
        id: 'claim',
        position: { x: centerX, y: topY },
        data: {
          label: (
            <div style={nodeStyle(xpColors.namespaced.bg)}>
              <div style={{ fontSize: 10, opacity: 0.85, marginBottom: 2 }}>Claim</div>
              <div>{claimNamespace}/{claimName}</div>
            </div>
          ),
        },
        style: { border: 'none', padding: 0, background: 'transparent' },
      });
      topY += 120;
    }

    if (compositeRef) {
      newNodes.push({
        id: 'xr',
        position: { x: centerX, y: topY },
        data: {
          label: (
            <div style={nodeStyle('#1565c0')}>
              <div style={{ fontSize: 10, opacity: 0.85, marginBottom: 2 }}>Composite Resource</div>
              <div>{compositeRef}</div>
            </div>
          ),
        },
        style: { border: 'none', padding: 0, background: 'transparent' },
      });
      if (claimName) {
        newEdges.push({
          id: 'claim-xr',
          source: 'claim',
          target: 'xr',
          label: 'claims',
          type: 'smoothstep',
        });
      }
      topY += 120;
    }

    // Focal MR node
    const mrColor = healthColor(item);
    newNodes.push({
      id: 'mr',
      position: { x: centerX, y: topY },
      data: {
        label: (
          <div style={nodeStyle(mrColor)}>
            <div style={{ fontSize: 10, opacity: 0.85, marginBottom: 2 }}>{item.kind ?? plural}</div>
            <div>{name}</div>
          </div>
        ),
      },
      style: { border: 'none', padding: 0, background: 'transparent' },
    });

    if (compositeRef) {
      newEdges.push({
        id: 'xr-mr',
        source: 'xr',
        target: 'mr',
        label: 'manages',
        type: 'smoothstep',
      });
    }

    topY += 120;

    if (providerConfigRef) {
      newNodes.push({
        id: 'pconfig',
        position: { x: centerX, y: topY },
        data: {
          label: (
            <div
              style={nodeStyle('#546e7a', true)}
              onClick={() =>
                history.push(
                  `${clusterPrefix()}/crossplane/providers/${providerName}/providerconfigs/${providerConfigRef}`
                )
              }
            >
              <div style={{ fontSize: 10, opacity: 0.85, marginBottom: 2 }}>ProviderConfig</div>
              <div>{providerConfigRef} ↗</div>
            </div>
          ),
        },
        style: { border: 'none', padding: 0, background: 'transparent' },
      });
      newEdges.push({
        id: 'mr-pconfig',
        source: 'mr',
        target: 'pconfig',
        label: 'uses config',
        type: 'smoothstep',
      });
    }

    setNodes(newNodes);
    setEdges(newEdges);
  }, [item, name, plural, providerName, namespace]);

  const backUrl = namespace
    ? `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${group}/${plural}/${namespace}/${name}`
    : `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${group}/${plural}/${name}`;

  if (!item && !error) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading resource…</Typography>
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

  return (
    <Box p={3}>
      <Box display="flex" alignItems="center" gap={2} mb={2}>
        <Button size="small" variant="outlined" onClick={() => history.push(backUrl)}>
          ← Back to {item?.kind ?? plural}
        </Button>
        <Typography variant="h5">
          Dependency Graph: {item?.kind ?? plural}/{name}
        </Typography>
      </Box>
      <Paper elevation={1} style={{ height: 520, borderRadius: 8, overflow: 'hidden' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0.3 }}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </Paper>
      <Box mt={2} display="flex" gap={2} flexWrap="wrap">
        {[
          { color: xpColors.healthy.bg, label: 'Ready & Synced' },
          { color: xpColors.degraded.bg, label: 'Not Ready / Not Synced' },
          { color: xpColors.warning.bg, label: 'Unknown' },
          { color: '#1565c0', label: 'Composite Resource' },
          { color: xpColors.namespaced.bg, label: 'Claim' },
          { color: '#546e7a', label: 'ProviderConfig' },
        ].map(({ color, label }) => (
          <Box key={label} display="flex" alignItems="center" gap={0.5}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: color, display: 'inline-block' }} />
            <Typography variant="caption">{label}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
