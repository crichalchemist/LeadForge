import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { applyTheme, onSystemThemeChange, readPreference, savePreference, type ThemePreference } from '../lib/theme';

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'enamel', label: 'Enamel', icon: Moon },
  { value: 'porcelain', label: 'Porcelain', icon: Sun },
];

/** System, Enamel or Porcelain (DESIGN.md, Colors), as a native radio group so arrow keys move between the
 *  three. In the 64px rail the words become screen-reader text beside the icons. */
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  // While the choice is System, follow the operating system as it changes.
  useEffect(() => (preference === 'system' ? onSystemThemeChange(() => applyTheme('system')) : undefined), [preference]);

  return (
    <fieldset>
      <legend className="font-condensed text-label uppercase text-dim rail:max-wide:sr-only">Theme</legend>
      <div className="mt-2 flex gap-0.5 rounded-control border border-edge p-0.5 rail:max-wide:flex-col">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <label key={value} className="flex-1">
            <input
              type="radio"
              name="theme"
              value={value}
              checked={preference === value}
              onChange={() => {
                savePreference(value);
                setPreference(value);
              }}
              className="peer sr-only"
            />
            <span className="flex cursor-pointer items-center justify-center gap-1 rounded-plate px-2 py-1 font-condensed text-label uppercase text-dim transition-colors duration-state ease-out-expo hover:text-text peer-checked:bg-text peer-checked:text-ground peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
              <Icon size={14} strokeWidth={2} aria-hidden="true" className="hidden rail:max-wide:block" />
              <span className="rail:max-wide:sr-only">{label}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
