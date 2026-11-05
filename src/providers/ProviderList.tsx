import { ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { ConditionBadge } from '../common/ConditionBadge';
import { Provider } from './provider';

function conditionFromJsonData(
  p: Provider,
  type: string,
  falseText: string
): { isTrue: boolean | undefined; text: string } {
  const conditions: any[] = p?.jsonData?.status?.conditions ?? [];
  switch (conditions.find((c: any) => c.type === type)?.status) {
    case 'True':
      return { isTrue: true, text: type };
    case 'False':
      return { isTrue: false, text: falseText };
    default:
      return { isTrue: undefined, text: 'Unknown' };
  }
}

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
          getValue: (p: Provider) => p?.jsonData?.spec?.package || '—',
        },
        {
          id: 'version',
          label: 'Version',
          getValue: (p: Provider) => {
            if (!p) return '—';
            const status = p.jsonData?.status;
            const pkg = status?.atPkg || p.jsonData?.spec?.package;
            if (pkg) {
              const parts = pkg.split(':');
              if (parts.length > 1) return parts[parts.length - 1];
            }
            return status?.currentRevision || '—';
          },
        },
        {
          id: 'installed',
          label: 'Installed',
          getValue: (p: Provider) => conditionFromJsonData(p, 'Installed', 'Not Installed').text,
          render: (p: Provider) => (
            <ConditionBadge {...conditionFromJsonData(p, 'Installed', 'Not Installed')} />
          ),
        },
        {
          id: 'healthy',
          label: 'Healthy',
          getValue: (p: Provider) => conditionFromJsonData(p, 'Healthy', 'Unhealthy').text,
          render: (p: Provider) => (
            <ConditionBadge {...conditionFromJsonData(p, 'Healthy', 'Unhealthy')} />
          ),
        },
        'age',
      ]}
    />
  );
}
