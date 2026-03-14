import { STAGE_COLORS, STAGE_LABELS } from '../../types';

interface BadgeProps {
  stage: string;
}

export default function Badge({ stage }: BadgeProps) {
  const color = STAGE_COLORS[stage] || 'bg-gray-100';
  const label = STAGE_LABELS[stage] || stage;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color} text-gray-800`}>
      {label}
    </span>
  );
}
