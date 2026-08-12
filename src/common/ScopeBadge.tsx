import { xpColors } from './colors';

interface ScopeBadgeProps {
  scope: 'Cluster' | 'Namespaced' | string;
  namespace?: string;
}

export function ScopeBadge({ scope, namespace }: ScopeBadgeProps) {
  const isNamespaced = scope === 'Namespaced';
  const badge = (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 500,
      background: 'transparent',
      border: '1px solid #bdbdbd',
      color: '#757575',
      verticalAlign: 'middle',
    }}>
      {isNamespaced ? 'Namespaced' : 'Cluster'}
    </span>
  );

  if (!isNamespaced || !namespace) return badge;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {badge}
      <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{namespace}</span>
    </span>
  );
}
