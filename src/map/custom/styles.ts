import { alpha, type SxProps, type Theme } from '@mui/material/styles';

export const NODE_WIDTH = 264;
export const RESOURCE_NODE_LAYOUT_HEIGHT = 148;
export const AGGREGATED_NODE_HEIGHT = 129.6;
export const NAMESPACE_LINE_HEIGHT = 20;
export const AUX_HANDLE_OFFSET = 32;
export const EDGE_LABEL_BG_PADDING: [number, number] = [8, 4];
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

export function getCardActionSx(theme: Theme, healthPalette?: { contrastText: string }) {
  return {
    minWidth: 0,
    minHeight: 32,
    px: 1,
    gap: 0.75,
    flexShrink: 0,
    borderRadius: 1,
    color: 'inherit',
    backgroundColor: 'transparent',
    '&:hover': {
      backgroundColor: alpha(healthPalette?.contrastText ?? theme.palette.text.secondary, 0.08),
      '@media (hover: none)': { backgroundColor: 'transparent' },
    },
    '&.Mui-focusVisible': {
      outline: `2px solid ${healthPalette?.contrastText ?? theme.palette.primary.main}`,
      outlineOffset: 2,
    },
  } satisfies SxProps<Theme>;
}
