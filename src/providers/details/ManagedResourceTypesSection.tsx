import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Provider } from '../provider';
import { NON_MANAGED_PLURALS, useCRDsForProvider } from '../../helpers';

export function ManagedResourceTypesSection({ provider }: { provider: Provider }) {
  const providerName = provider.getName();
  const [crds, error] = useCRDsForProvider(providerName, provider.currentRevision);

  const managedCrds = (crds ?? []).filter(
    (crd: any) => !NON_MANAGED_PLURALS.has(crd.jsonData?.spec?.names?.plural ?? '')
  );

  return (
    <SectionBox title="Managed Resource Types">
      <SimpleTable
        data={crds ? managedCrds : null}
        emptyMessage="No managed resource CRDs found."
        errorMessage={error ? 'Error loading CRDs.' : null}
        columns={[
          {
            label: 'Kind',
            getter: (crd: any) => (
              <Link
                routeName="crossplaneManagedList"
                params={{
                  providerName,
                  group: crd.jsonData?.spec?.group,
                  plural: crd.jsonData?.spec?.names?.plural,
                }}
              >
                {crd.jsonData?.spec?.names?.kind}
              </Link>
            ),
          },
          {
            label: 'Name',
            getter: (crd: any) => crd.metadata?.name,
          },
          {
            label: 'Scope',
            getter: (crd: any) => crd.jsonData?.spec?.scope ?? '—',
          },
        ]}
      />
    </SectionBox>
  );
}
