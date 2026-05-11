import React from 'react';
import { useHistory } from 'react-router-dom';
import { Composition, CompositeResourceDefinition } from '../common/Resources';

const { Typography, Box, Chip, CircularProgress, Paper } =
  (window as any).pluginLib?.MuiCore ?? {};

function readyChip(conditions: any[]) {
  const cond = conditions?.find((c: any) => c.type === 'Established' || c.type === 'Ready');
  if (!cond) return <Chip label="Unknown" size="small" />;
  const ok = cond.status === 'True';
  return (
    <Chip
      label={ok ? 'Ready' : 'Not Ready'}
      size="small"
      style={{ background: ok ? '#4caf50' : '#f44336', color: '#fff', fontWeight: 600 }}
    />
  );
}

export default function CompositionList() {
  const [compositions, compErr] = Composition.useList();
  const [xrds, xrdErr] = CompositeResourceDefinition.useList();

  const loading = !compositions && !compErr;
  const error = compErr || xrdErr;

  if (loading) {
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
          Failed to load: {String(error)}. Crossplane apiextensions CRDs may not be installed.
        </Typography>
      </Box>
    );
  }

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        Compositions & XRDs
      </Typography>

      {/* Compositions table */}
      <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
        <Typography variant="h6" gutterBottom>
          Compositions ({compositions?.length ?? 0})
        </Typography>
        {!compositions || compositions.length === 0 ? (
          <Typography variant="body2" color="textSecondary">No Compositions found.</Typography>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                {['Name', 'Composite Type', 'Age'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compositions.map((comp: any) => {
                const typeRef = comp.jsonData?.spec?.compositeTypeRef ?? {};
                return (
                  <tr key={comp.metadata.name} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                      {comp.metadata.name}
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>
                      {typeRef.apiVersion} / {typeRef.kind}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 12 }}>
                      {comp.metadata?.creationTimestamp
                        ? new Date(comp.metadata.creationTimestamp).toLocaleDateString()
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Paper>

      {/* XRDs table */}
      <Paper elevation={1} style={{ padding: 16 }}>
        <Typography variant="h6" gutterBottom>
          Composite Resource Definitions – XRDs ({xrds?.length ?? 0})
        </Typography>
        {!xrds || xrds.length === 0 ? (
          <Typography variant="body2" color="textSecondary">No XRDs found.</Typography>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                {['Name', 'Group', 'Kind', 'Status', 'Age'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {xrds.map((xrd: any) => {
                const conditions: any[] = xrd.jsonData?.status?.conditions ?? [];
                const group = xrd.jsonData?.spec?.group ?? '';
                const kind = xrd.jsonData?.spec?.names?.kind ?? '';
                return (
                  <tr key={xrd.metadata.name} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                      {xrd.metadata.name}
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>
                      {group}
                    </td>
                    <td style={{ padding: '8px 12px' }}>{kind}</td>
                    <td style={{ padding: '8px 12px' }}>{readyChip(conditions)}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12 }}>
                      {xrd.metadata?.creationTimestamp
                        ? new Date(xrd.metadata.creationTimestamp).toLocaleDateString()
                        : '—'}
                    </td>
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
