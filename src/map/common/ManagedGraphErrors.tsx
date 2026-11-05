import { Alert, Box, Typography } from '@mui/material';
import { ManagedGraphData } from './types';

export function ManagedGraphErrors({
  error,
  resourceErrors = [],
}: Pick<ManagedGraphData, 'error' | 'resourceErrors'>) {
  if (!error && resourceErrors.length === 0) return null;

  return (
    <Alert severity={error ? 'error' : 'warning'} sx={{ flexShrink: 0 }}>
      <Typography variant="body2">
        {error
          ? 'Failed to discover Crossplane resources: ' + error.message
          : 'Crossplane data is incomplete. Some resources could not be loaded.'}
      </Typography>
      {resourceErrors.length > 0 && (
        <Box
          component="ul"
          tabIndex={0}
          aria-label="Crossplane resource errors"
          sx={{ m: 0, pl: 2, maxHeight: 120, overflow: 'auto' }}
        >
          {resourceErrors.map(({ crdName, namespace, error }) => (
            <li key={JSON.stringify([crdName, namespace])}>
              {crdName}
              {namespace ? ` (namespace: ${namespace})` : ''}: {error.message}
            </li>
          ))}
        </Box>
      )}
    </Alert>
  );
}
