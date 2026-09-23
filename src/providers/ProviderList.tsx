import { ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { ConditionBadge } from '../common/ConditionBadge';
import { Provider } from './provider';

export function ProviderList() {
  return (
    <ResourceListView
      title="Crossplane Providers"
      resourceClass={Provider}
      headerProps={{ titleSideActions: [] }}
      columns={[
        'name',
        {
          id: 'package',
          label: 'Package',
          getValue: (provider: Provider) => provider.packageRef || '—',
        },
        {
          id: 'version',
          label: 'Version',
          getValue: (provider: Provider) => provider.installedVersion || '—',
        },
        {
          id: 'installed',
          label: 'Installed',
          getValue: (p: Provider) => p.installStatus.text,
          render: (p: Provider) => <ConditionBadge {...p.installStatus} />,
        },
        {
          id: 'healthy',
          label: 'Healthy',
          getValue: (p: Provider) => p.health.text,
          render: (p: Provider) => <ConditionBadge {...p.health} />,
        },
        'age',
      ]}
    />
  );
}
