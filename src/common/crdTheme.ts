// Theme-aware neutral colors for the CRD browser views. The plugin's inline
// styles otherwise hardcode light backgrounds/borders that stay white in dark
// mode; these follow the OS color scheme the same way Headlamp's own theme does.

export function isDarkMode(): boolean {
  return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function neutralColors() {
  const dark = isDarkMode();
  return {
    surface: dark ? '#2a2a2a' : '#fafafa',
    border: dark ? '#3a3a3a' : '#e0e0e0',
    borderSubtle: dark ? '#2f2f2f' : '#f0f0f0',
    muted: dark ? '#9e9e9e' : '#888',
  };
}
