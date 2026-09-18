import { StatusLabel } from '@kinvolk/headlamp-plugin/lib/CommonComponents';

export interface ConditionBadgeProps {
  isTrue?: boolean;
  text: string;
}

export function ConditionBadge({ isTrue, text }: ConditionBadgeProps) {
  const statusType = isTrue === true ? 'success' : isTrue === false ? 'error' : '';
  return <StatusLabel status={statusType}>{text}</StatusLabel>;
}
