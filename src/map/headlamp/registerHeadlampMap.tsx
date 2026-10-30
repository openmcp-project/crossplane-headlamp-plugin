import { Icon } from '@iconify/react';
import {
  registerKindIcon,
  registerMapSource,
  registerRoute,
  Router,
} from '@kinvolk/headlamp-plugin/lib';
import { Box } from '@mui/material';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { crossplaneColorIcon } from '../../common/crossplaneIcon';
import { ManagedGraphErrors } from '../common/ManagedGraphErrors';
import { ManagedGraphData } from '../common/types';
import { useManagedGraph } from '../common/useManagedGraph';

type SourceErrors = Pick<ManagedGraphData, 'error' | 'resourceErrors'>;
const ReportSourceErrorsContext = createContext<(errors: SourceErrors | null) => void>(() => {});

function MapWithSourceErrors({ children }: { children: ReactNode }) {
  const [errors, setErrors] = useState<SourceErrors | null>(null);
  return (
    <ReportSourceErrorsContext.Provider value={setErrors}>
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {errors && (
          <Box sx={{ mx: 3, mt: 2 }}>
            <ManagedGraphErrors {...errors} />
          </Box>
        )}
        <Box sx={{ flex: 1, minHeight: 0 }}>{children}</Box>
      </Box>
    </ReportSourceErrorsContext.Provider>
  );
}

// Both maps consume the same graph; this adapter supplies Headlamp registration metadata.
const crossplaneMapSource = {
  id: 'crossplane-ecosystem',
  label: 'Crossplane',
  icon: <Icon icon={crossplaneColorIcon} width="100%" height="100%" />,
  sources: [
    {
      id: 'crossplane-managed-resources',
      label: 'Managed Resources',
      icon: <Icon icon={crossplaneColorIcon} width="100%" height="100%" />,
      useData() {
        const data = useManagedGraph();
        const reportErrors = useContext(ReportSourceErrorsContext);
        const error = data?.error;
        const resourceErrors = data?.resourceErrors;
        // GraphSource only consumes nodes/edges; the route wrapper displays source errors.
        useEffect(() => {
          reportErrors(
            error || resourceErrors?.length ? { error, resourceErrors: resourceErrors ?? [] } : null
          );
          return () => reportErrors(null);
        }, [error, resourceErrors, reportErrors]);
        return data;
      },
    },
  ],
};

// Generic managed-resource icon; per-kind color is applied via registerKindIcon,
// which is the closest the standard map gets to the ui-frontend "color by
// provider" — one shared glyph, distinguished by color.
const ManagedResourceIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em">
    <path
      fill="currentColor"
      d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3 6.5 3.6L12 11.5 5.5 7.9 12 4.3ZM5 9.6l6 3.4v6.9l-6-3.3V9.6Zm14 0v7l-6 3.3v-6.9l6-3.4Z"
    />
  </svg>
);

// The managed-resource kinds we recognise, each with a distinct icon color.
// Unknown kinds fall back to Headlamp's default icon.
const MANAGED_KIND_COLORS: Record<string, string> = {
  Subaccount: '#049F9A',
  ServiceManager: '#7858FF',
  CloudManagement: '#DF1278',
  ServiceInstance: '#FF8AF0',
  ServiceBinding: '#2CE0BF',
  Entitlement: '#FFC933',
};

export function registerHeadlampMap() {
  const mapRoute = Router.getDefaultRoutes().map;
  if (mapRoute?.component) {
    const Map = mapRoute.component;
    registerRoute({
      ...mapRoute,
      component: () => (
        <MapWithSourceErrors>
          <Map />
        </MapWithSourceErrors>
      ),
    });
  }

  for (const [kind, color] of Object.entries(MANAGED_KIND_COLORS)) {
    registerKindIcon(kind, { icon: <ManagedResourceIcon />, color });
  }

  registerMapSource(crossplaneMapSource);
}
