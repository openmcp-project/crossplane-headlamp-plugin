import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useEffect, useState } from 'react';
import { getApiProxy, useCRDsForProvider } from '../../helpers';
import { Provider } from '../provider';

export function ProviderConfigsSection({ provider }: { provider: Provider }) {
  const providerName = provider.getName();
  const [crds] = useCRDsForProvider(providerName, provider.currentRevision);
  const [configs, setConfigs] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const configCrd = crds?.find(
    (crd: any) => crd.jsonData?.spec?.names?.plural === 'providerconfigs'
  );

  useEffect(() => {
    if (!configCrd) {
      setConfigs([]);
      return;
    }
    const group: string = configCrd.jsonData?.spec?.group ?? '';
    const version: string =
      configCrd.jsonData?.spec?.versions?.find((v: any) => v.served)?.name ??
      configCrd.jsonData?.spec?.versions?.[0]?.name ??
      'v1alpha1';
    let isCancelled = false;
    setError(null);
    getApiProxy()
      .request(`/apis/${group}/${version}/providerconfigs`, { isJSON: true })
      .then((res: any) => !isCancelled && setConfigs(res?.items ?? []))
      .catch(() => {
        if (!isCancelled) {
          setError('Failed to load ProviderConfigs.');
          setConfigs([]);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [configCrd?.metadata?.name]);

  return (
    <SectionBox title="Provider Configs">
      <SimpleTable
        data={error ? [] : configs}
        errorMessage={error}
        emptyMessage="No ProviderConfigs found."
        columns={[
          {
            label: 'Name',
            getter: (config: any) => (
              <Link
                routeName="crossplaneProviderConfigDetail"
                params={{ providerName, configName: config.metadata?.name }}
              >
                {config.metadata?.name}
              </Link>
            ),
          },
          {
            label: 'Credentials',
            getter: (config: any) => {
              const secretRef = config.spec?.credentials?.secretRef;
              return secretRef
                ? `${secretRef.namespace}/${secretRef.name}`
                : config.spec?.credentials?.source ?? '—';
            },
          },
        ]}
      />
    </SectionBox>
  );
}
