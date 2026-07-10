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
import ProviderConfigDetail from './providerconfigs/ProviderConfigDetail';
import DependencyGraph from './graph/DependencyGraph'; // reserved for future use

const crossplaneIcon = {
  body: '<path fill="currentColor" d="M471.223 669.718V790.456c0 16.824-10.956 30.526-24.407 30.526-13.451 0-24.407-13.688-24.407-30.526V669.718h48.814m22.358-22.358H400.037V790.456c0 29.216 20.936 52.884 46.765 52.884 25.843 0 46.765-23.668 46.765-52.884V647.36z"/><path fill="currentColor" d="M588.56 154.079a163.283 163.283 0 0 1 25.829 81.417c.111 2.537.181 5.13.181 7.708 0 2.537-.07 5.171-.195 7.862l-.056 1.1.056 1.102c.042.641.084 1.268.125 1.91.056.864.126 1.687.126 2.174v87.689L323.736 635.93a85.3 85.3 0 0 1-40.2-72.398V459.102L588.56 154.079m2.3-32.045L262.503 450.404V563.546c0 43.963 27.013 81.919 65.248 98.102L635.645 353.752V257.365c0-1.784-.181-3.513-.279-5.269.14-2.955.223-5.91.223-8.893q0-4.37-.195-8.67a185.616 185.616 0 0 0-44.534-112.5z"/><path fill="currentColor" d="M449.046 56.66c-100.123 0-181.832 78.866-186.348 177.873q-.189 4.308-.195 8.67c0 3.192.07 6.356.237 9.506-.07 1.561-.237 3.081-.237 4.656V450.32L590.832 121.991A186.133 186.133 0 0 0 449.046 56.66z"/><path fill="currentColor" d="M368.954 669.997H529.18c58.557 0 106.465-47.908 106.465-106.451V353.041L327.263 661.424a105.432 105.432 0 0 0 41.691 8.573z"/>',
  width: 900,
  height: 900,
};

// ── Sidebar ──────────────────────────────────────────────────────────────────

registerSidebarEntry({
  parent: null,
  name: 'crossplane',
  label: 'Crossplane',
  url: '/crossplane/overview',
  icon: crossplaneIcon,
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
