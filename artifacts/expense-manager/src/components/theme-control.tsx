import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { applyTheme, getThemeChoice, setThemeChoice, type ThemeChoice } from '@/lib/theme';

const options = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const;

export function ThemeControl() {
  const [choice, setChoice] = useState<ThemeChoice>('dark');

  useEffect(() => {
    const stored = getThemeChoice();
    setChoice(stored);
    applyTheme(stored);
  }, []);

  useEffect(() => {
    if (choice !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => applyTheme('system');
    media.addEventListener('change', onSystemChange);
    return () => media.removeEventListener('change', onSystemChange);
  }, [choice]);

  return (
    <div className="inline-flex rounded-xl bg-secondary/65 p-1" role="radiogroup" aria-label="Appearance" data-testid="group-theme">
      {options.map(({ value, label, Icon }) => {
        const selected = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => { setChoice(value); setThemeChoice(value); }}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-colors ${selected ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            data-testid={`button-theme-${value}`}
          >
            <Icon size={14} /> {label}
          </button>
        );
      })}
    </div>
  );
}
