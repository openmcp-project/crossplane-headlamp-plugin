import {
  ConditionsTable,
  DetailsGrid,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useParams } from 'react-router-dom';
import { ConditionBadge } from '../common/ConditionBadge';
import { AllInstancesSection } from './details/AllInstancesSection';
import { ManagedResourceTypesSection } from './details/ManagedResourceTypesSection';
import { ProviderConfigsSection } from './details/ProviderConfigsSection';
import { Provider } from './provider';

export function ProviderDetails() {
  const params = useParams<{ name: string }>();
  const { name } = params;

  return (
    <DetailsGrid
      resourceType={Provider}
      name={name}
      withEvents
      extraInfo={provider =>
        provider
          ? [
              { name: 'Package', value: provider.packageRef },
              { name: 'Version', value: provider.installedVersion },
              { name: 'Current Revision', value: provider.currentRevision },
              {
                name: 'Installed',
                value: <ConditionBadge {...provider.installStatus} />,
              },
              {
                name: 'Healthy',
                value: <ConditionBadge {...provider.health} />,
              },
            ]
          : []
      }
      extraSections={provider =>
        provider
          ? [
              {
                id: 'crossplane-provider-conditions',
                section: (
                  <SectionBox title="Conditions">
                    <ConditionsTable resource={provider.jsonData} />
                  </SectionBox>
                ),
              },
              {
                id: 'crossplane-provider-configs',
                section: <ProviderConfigsSection provider={provider} />,
              },
              {
                id: 'crossplane-provider-managed-types',
                section: <ManagedResourceTypesSection provider={provider} />,
              },
              {
                id: 'crossplane-provider-all-instances',
                section: <AllInstancesSection provider={provider} />,
              },
            ]
          : []
      }
    />
  );
}
