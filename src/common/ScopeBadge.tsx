import { useTheme } from '@mui/material';
import { xpColors } from './colors';
import styles from './ScopeBadge.module.css';

interface ScopeBadgeProps {
  scope: 'Cluster' | 'Namespaced' | string;
  namespace?: string;
}

function badgeColors(hasNamespace: boolean, isNamespaced: boolean, hue: number, dark: boolean) {
  if (hasNamespace) {
    return {
      bg: `hsl(${hue}, 45%, ${dark ? '25%' : '93%'})`,
      color: `hsl(${hue}, 40%, ${dark ? '80%' : '30%'})`,
    };
  }
  if (isNamespaced) {
    return { bg: xpColors.namespaced.bg, color: '#fff' };
  }
  return { bg: dark ? '#424242' : '#eeeeee', color: dark ? '#bdbdbd' : '#616161' };
}

export function ScopeBadge({ scope, namespace }: ScopeBadgeProps) {
  const dark = useTheme().palette.mode === 'dark';
  const isNamespaced = scope === 'Namespaced';
  // Derive a stable hue so a namespace keeps its color across sorting and filtering.
  let hash = 0;
  for (const char of namespace ?? '') {
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  }
  const hue = hash % 360;
  const hasNamespace = isNamespaced && !!namespace;
  const { bg, color } = badgeColors(hasNamespace, isNamespaced, hue, dark);

  return (
    <span className={styles.badge} style={{ background: bg, color }}>
      {hasNamespace ? namespace : isNamespaced ? 'Namespaced' : 'Cluster'}
    </span>
  );
}
