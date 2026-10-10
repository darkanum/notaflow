// The same storage key as Malphas (assets/malphas.js), so a choice made in one Vapulab app sticks.
const THEME_KEY = 'malphas-theme';

function isDark(): boolean {
  const chosen = document.documentElement.dataset.theme;
  if (chosen) return chosen === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function setTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Without storage the choice lasts until the page reloads.
  }
}

// Malphas ThemeToggle (app/views/page.templ). CSS picks the glyph, so no state is needed.
export function ThemeToggle() {
  return (
    <button
      type="button"
      title="Alternar entre tema claro e escuro"
      aria-label="Alternar entre tema claro e escuro"
      className="rounded border border-border px-2 py-1 text-sm text-muted hover:text-fg"
      onClick={() => setTheme(isDark() ? 'light' : 'dark')}
    >
      <span className="dark:hidden" aria-hidden="true">
        ☾
      </span>
      <span className="hidden dark:inline" aria-hidden="true">
        ☀
      </span>
    </button>
  );
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

// Malphas Avatar with initials (components/avatar.templ), size sm, circle.
export function Avatar(props: { initials: string; label: string }) {
  return (
    <span className="relative inline-flex shrink-0" title={props.label}>
      <span className="inline-flex items-center justify-center bg-muted/20 font-medium text-fg size-8 text-xs rounded-full">
        {props.initials}
      </span>
      <span className="sr-only">{props.label}</span>
    </span>
  );
}
