/** Lightweight segmented control (Halo Segmented look, no base-ui/motion): the thumb slides via CSS transform only. */

interface SegmentedControlProps<T extends number | string> {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  renderLabel?: (v: T) => string;
}

export function SegmentedControl<T extends number | string>({
  options,
  value,
  onChange,
  label,
  renderLabel = String,
}: SegmentedControlProps<T>) {
  const index = Math.max(0, options.indexOf(value));
  return (
    <div role="group" aria-label={label} className="relative inline-grid grid-flow-col auto-cols-fr rounded-xl bg-sunken border border-line/60 p-1">
      <span
        aria-hidden="true"
        className="absolute top-1 bottom-1 left-1 rounded-lg bg-accent shadow transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={`relative z-10 px-3.5 min-h-[40px] min-w-[44px] rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
            value === o ? 'text-on-accent' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {renderLabel(o)}
        </button>
      ))}
    </div>
  );
}
