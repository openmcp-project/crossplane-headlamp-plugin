import type { SxProps, Theme } from '@mui/material/styles';

export const NODE_WIDTH = 264;
// Reserve space for a two-line name and the separate status/action footer.
export const NODE_HEIGHT = 156;
export const NAMESPACE_LINE_HEIGHT = 20;
export const PANEL_ELEVATION = 2;
export const PANEL_SX = {
  border: (theme: Theme) => (theme.palette.mode === 'dark' ? 1 : 0),
  borderColor: 'divider',
  borderRadius: 1,
  overflow: 'hidden',
} satisfies SxProps<Theme>;
export const CATEGORY_SWATCH_SX = {
  width: 10,
  height: 10,
  borderRadius: '2px',
  flexShrink: 0,
  backgroundColor: 'color-mix(in srgb, currentColor 80%, white)',
} satisfies SxProps<Theme>;
// Trim font leading so icons and markers align with the letters rather than the line box.
export const TRIMMED_TEXT_SX = { textBox: 'trim-both cap alphabetic' } satisfies SxProps<Theme>;
