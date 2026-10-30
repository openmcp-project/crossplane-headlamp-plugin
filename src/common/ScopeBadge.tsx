import { xpColors } from './colors';

interface ScopeBadgeProps {
  scope: 'Cluster' | 'Namespaced' | string;
  namespace?: string;
}

export function ScopeBadge({ scope, namespace }: ScopeBadgeProps) {
  const isNamespaced = scope === 'Namespaced';
  // Derive a stable hue so a namespace keeps its color across sorting and filtering.
  let hash = 0;
  for (const char of namespace ?? '') {
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  }
  const hue = hash % 360;
  const hasNamespace = isNamespaced && !!namespace;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 600,
        background: hasNamespace
          ? `hsl(${hue}, 45%, 93%)`
          : isNamespaced
          ? xpColors.namespaced.bg
          : '#eeeeee',
        color: hasNamespace ? `hsl(${hue}, 40%, 30%)` : isNamespaced ? '#fff' : '#616161',
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
      }}
    >
      {hasNamespace ? namespace : isNamespaced ? 'Namespaced' : 'Cluster'}
    </span>
  );
}
