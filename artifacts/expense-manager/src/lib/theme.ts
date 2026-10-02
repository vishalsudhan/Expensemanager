export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'pocketful-theme';

export function getThemeChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Ignore storage access errors and fall back to the default.
  }
  return 'dark';
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  const dark = choice === 'system' ? prefersDark() : choice === 'dark';
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', dark ? '#1a2321' : '#f4efe4');
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Ignore storage access errors.
  }
  applyTheme(choice);
}
