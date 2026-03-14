interface ScoreGaugeProps {
  label: string;
  value: number | null;
  max?: number;
}

export default function ScoreGauge({ label, value, max = 100 }: ScoreGaugeProps) {
  const pct = value != null ? Math.min((value / max) * 100, 100) : 0;
  const color =
    pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium">{value != null ? value.toFixed(1) : '--'}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
