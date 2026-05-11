import {
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import CrossplaneOverview from './overview';
import ProviderList from './providers/ProviderList';
import ProviderDetail from './providers/ProviderDetail';
import ManagedList from './managed/ManagedList';
import ManagedDetail from './managed/ManagedDetail';
import ResourceList from './resources/ResourceList';

// ── Sidebar ──────────────────────────────────────────────────────────────────

registerSidebarEntry({
  parent: null,
  name: 'crossplane',
  label: 'Crossplane',
  url: '/crossplane/overview',
  icon: 'mdi:crosshairs-gps',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-overview',
  label: 'Overview',
  url: '/crossplane/overview',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-providers',
  label: 'Providers',
  url: '/crossplane/providers',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-resources',
  label: 'Resources',
  url: '/crossplane/resources',
});

// ── Routes ───────────────────────────────────────────────────────────────────

registerRoute({
  path: '/crossplane/overview',
  sidebar: 'crossplane-overview',
  name: 'crossplaneOverview',
  exact: true,
  component: () => React.createElement(CrossplaneOverview),
});

registerRoute({
  path: '/crossplane/providers',
  sidebar: 'crossplane-providers',
  name: 'crossplaneProviders',
  exact: true,
  component: () => React.createElement(ProviderList),
});

registerRoute({
  path: '/crossplane/providers/:name',
  sidebar: 'crossplane-providers',
  name: 'crossplaneProviderDetail',
  exact: true,
  component: () => React.createElement(ProviderDetail),
});

// Namespaced managed resource detail (namespace + name both present)
registerRoute({
  path: '/crossplane/providers/:providerName/resources/:group/:plural/:namespace/:name',
  sidebar: 'crossplane-providers',
  name: 'crossplaneManagedDetailNamespaced',
  exact: true,
  component: () => React.createElement(ManagedDetail),
});

// Cluster-scoped managed resource detail
registerRoute({
  path: '/crossplane/providers/:providerName/resources/:group/:plural/:name',
  sidebar: 'crossplane-providers',
  name: 'crossplaneManagedDetail',
  exact: true,
  component: () => React.createElement(ManagedDetail),
});

// Managed resource list for a provider CRD type
registerRoute({
  path: '/crossplane/providers/:providerName/resources/:group/:plural',
  sidebar: 'crossplane-providers',
  name: 'crossplaneManagedList',
  exact: true,
  component: () => React.createElement(ManagedList),
});

registerRoute({
  path: '/crossplane/resources',
  sidebar: 'crossplane-resources',
  name: 'crossplaneResources',
  exact: true,
  component: () => React.createElement(ResourceList),
});
