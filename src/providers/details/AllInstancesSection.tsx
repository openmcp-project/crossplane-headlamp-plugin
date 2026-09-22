import { Link, SectionBox, SimpleTable, StatusLabel } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useAllManagedResources } from '../../helpers';
import { Provider } from '../provider';

export function AllInstancesSection({ provider }: { provider: Provider }) {
  const providerName = provider.getName();
  const { items, loading } = useAllManagedResources(providerName);

  const renderCondition = (item: any, type: string) => {
    const conditions: any[] = item.status?.conditions ?? [];
    const cond = conditions.find((c: any) => c.type === type);
    if (!cond) return <StatusLabel status="">—</StatusLabel>;
    const isTrue = cond.status === 'True';
    const statusType = isTrue ? 'success' : cond.status === 'False' ? 'error' : '';
    return <StatusLabel status={statusType}>{isTrue ? type : `Not ${type}`}</StatusLabel>;
  };

  return (
    <SectionBox title="All Instances">
      <SimpleTable
        data={loading ? null : items}
        emptyMessage="No instances found."
        columns={[
          {
            label: 'Kind',
            getter: (item: any) => item._kind,
          },
          {
            label: 'Name',
            getter: (item: any) => {
              const ns = item.metadata?.namespace;
              const name = item.metadata?.name;
              return (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <Link
                    routeName={ns ? 'crossplaneManagedDetailNamespaced' : 'crossplaneManagedDetail'}
                    params={{
                      providerName,
                      group: item._group,
                      plural: item._plural,
                      namespace: ns,
                      name,
                    }}
                  >
                    {name}
                  </Link>
                  {ns && (
                    <span style={{ fontSize: '0.85em', color: '#666' }}>{ns}</span>
                  )}
                </div>
              );
            },
          },
          {
            label: 'Ready',
            getter: (item: any) => renderCondition(item, 'Ready'),
          },
          {
            label: 'Synced',
            getter: (item: any) => renderCondition(item, 'Synced'),
          },
          {
            label: 'Age',
            getter: (item: any) =>
              item.metadata?.creationTimestamp
                ? new Date(item.metadata.creationTimestamp).toLocaleDateString()
                : '—',
          },
        ]}
      />
    </SectionBox>
  );
}
