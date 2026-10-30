import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import { crossplaneMonochromeIcon } from './common/crossplaneIcon';
import CRDList, { CRDDetail } from './crds/CRDList';
import ManagedDetail from './managed/ManagedDetail';
import ManagedList from './managed/ManagedList';
import CrossplaneMap from './map/custom/CrossplaneMap';
import { registerHeadlampMap } from './map/headlamp/registerHeadlampMap';
import CrossplaneOverview from './overview';
import ProviderConfigDetail from './providerconfigs/ProviderConfigDetail';
import { PROVIDER_DETAILS_ROUTE, PROVIDER_LIST_ROUTE } from './providers/provider';
import { ProviderDetails } from './providers/ProviderDetails';
import { ProviderList } from './providers/ProviderList';
import ResourceList from './resources/ResourceList';

// ── Sidebar ──────────────────────────────────────────────────────────────────

registerSidebarEntry({
  parent: null,
  name: 'crossplane',
  label: 'Crossplane',
  url: '/crossplane/overview',
  icon: crossplaneMonochromeIcon,
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

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-crds',
  label: 'CRDs',
  url: '/crossplane/crds',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-map',
  label: 'Map',
  url: '/crossplane/map',
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
  name: PROVIDER_LIST_ROUTE,
  exact: true,
  component: ProviderList,
});

registerRoute({
  path: '/crossplane/providers/:name',
  sidebar: 'crossplane-providers',
  name: PROVIDER_DETAILS_ROUTE,
  exact: true,
  component: ProviderDetails,
});

registerRoute({
  path: '/crossplane/providers/:providerName/providerconfigs/:configName',
  sidebar: 'crossplane-providers',
  name: 'crossplaneProviderConfigDetail',
  exact: true,
  component: () => React.createElement(ProviderConfigDetail),
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

registerRoute({
  path: '/crossplane/crds',
  sidebar: 'crossplane-crds',
  name: 'crossplaneCRDs',
  exact: true,
  component: () => React.createElement(CRDList),
});

registerRoute({
  path: '/crossplane/crds/detail',
  sidebar: 'crossplane-crds',
  name: 'crossplaneCRDDetail',
  exact: true,
  component: () => React.createElement(CRDDetail),
});

registerRoute({
  path: '/crossplane/map',
  sidebar: 'crossplane-map',
  name: 'crossplaneMap',
  exact: true,
  isFullWidth: true,
  component: () => React.createElement(CrossplaneMap),
});

// ── Map integration ───────────────────────────────────────────────────────────

registerHeadlampMap();
