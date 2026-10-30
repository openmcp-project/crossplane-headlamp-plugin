import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  colors,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Handle, Node, NodeProps, Position, useReactFlow } from '@xyflow/react';
import { CATEGORY_SWATCH_SX, NAMESPACE_LINE_HEIGHT, NODE_WIDTH, TRIMMED_TEXT_SX } from './styles';

export type ResourceNodeData = {
  kind: string;
  name: string;
  namespace?: string;
  kubeObject?: any;
  customResourceDefinition?: string;
  providerName?: string;
  // Resolved color for the active category mode; undefined = uncategorized (mode "none").
  color?: string;
  // Display text is separate from the category key so missing values have a readable label.
  categoryLabel?: string;
  // Ready-and-synced health, derived upstream in the graph source.
  status?: 'success' | 'error';
  childCount?: number;
  collapsed?: boolean;
  onOpenDetails?: () => void;
  onToggleCollapse?: (id: string) => void;
};

/**
 * A single resource card. Themed via MUI so it follows Headlamp's light/dark
 * palette; React Flow supplies `selected`, which drives the accent border.
 * Handles sit top/bottom to match the top-down ELK layout.
 */
export function ResourceNode({ id, data, selected }: NodeProps<Node<ResourceNodeData>>) {
  const theme = useTheme();
  const { getInternalNode, getViewport, setCenter } = useReactFlow<Node<ResourceNodeData>>();
  const handleStyle = {
    width: 7,
    height: 7,
    // Keep handles inside the card so edge endpoints sit on its border.
    transform: 'translateX(-50%)',
    // Keep the anchors measurable for edge positioning.
    opacity: 0,
  };

  const color = data.color;
  const accent = color ?? theme.palette.primary.main;
  const interactive = Boolean(data.onOpenDetails);
  const resourceName = data.namespace ? `${data.namespace}/${data.name}` : data.name;

  function handleFocus(event: React.FocusEvent<HTMLElement>) {
    if (!event.target.matches(':focus-visible')) return;
    const node = getInternalNode(id);
    const viewport = event.currentTarget.closest('.react-flow');
    if (!node || !viewport) return;
    const { x, y, zoom } = getViewport();
    const position = node.internals.positionAbsolute;
    const width = event.currentTarget.offsetWidth;
    const height = event.currentTarget.offsetHeight;
    if (
      position.x * zoom + x >= 0 &&
      (position.x + width) * zoom + x <= viewport.clientWidth &&
      position.y * zoom + y >= 0 &&
      (position.y + height) * zoom + y <= viewport.clientHeight
    ) {
      return;
    }
    // Native button focus must pan the graph just as node focus did.
    setCenter(position.x + width / 2, position.y + height / 2, { zoom });
  }

  return (
    <>
      <Handle type="target" position={Position.Top} style={handleStyle} isConnectable={false} />
      <Card
        className="nodrag nopan"
        variant="elevation"
        elevation={selected ? 2 : 1}
        onDoubleClick={(event: React.MouseEvent) => event.stopPropagation()}
        onFocus={handleFocus}
        sx={{
          width: NODE_WIDTH,
          boxSizing: 'border-box',
          borderRadius: 1,
          // Keep the border's space on selection so text and handles do not shift.
          border: '1px solid',
          borderColor: selected ? 'transparent' : theme.palette.divider,
          // React Flow leaves the node container inert; the card owns its controls.
          pointerEvents: 'auto',
          boxShadow: selected ? `0 0 0 1.5px ${accent}, ${theme.shadows[2]}` : undefined,
          transition: 'box-shadow 120ms',
        }}
      >
        <Box
          component={interactive ? CardActionArea : 'div'}
          onClick={data.onOpenDetails}
          aria-label={interactive ? `Show details for ${data.kind} ${resourceName}` : undefined}
          sx={{
            display: 'block',
            textAlign: 'left',
            '&.Mui-focusVisible': {
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: -2,
            },
          }}
        >
          <CardContent
            component="span"
            sx={{
              display: 'flex',
              flexDirection: 'column',
              px: 2,
              py: 1.5,
              '&:last-child': { pb: 1.5 },
            }}
          >
            {data.categoryLabel && (
              <Box
                component="span"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  mb: 0.5,
                  minWidth: 0,
                  typography: 'caption',
                  minHeight: '1.4em',
                }}
              >
                <Box
                  component="span"
                  aria-hidden="true"
                  sx={{
                    ...CATEGORY_SWATCH_SX,
                    color: color ?? theme.palette.text.secondary,
                  }}
                />
                <Typography
                  variant="caption"
                  title={data.categoryLabel}
                  sx={{
                    ...TRIMMED_TEXT_SX,
                    display: 'block',
                    minWidth: 0,
                    color: color ?? theme.palette.text.secondary,
                    fontWeight: 600,
                    lineHeight: 1.4,
                    whiteSpace: 'nowrap',
                    // Clip horizontally for ellipsis while leaving trimmed descenders visible.
                    overflowX: 'clip',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {data.categoryLabel}
                </Typography>
              </Box>
            )}
            <Typography
              component="span"
              title={resourceName}
              sx={{
                fontSize: 14,
                lineHeight: '18px',
                fontWeight: 600,
                color: theme.palette.text.primary,
                // Resource names have no spaces; keep the full name in the DOM.
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                overflowWrap: 'anywhere',
              }}
            >
              {data.name}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                mt: 1.5,
                color: theme.palette.text.secondary,
                lineHeight: 1.4,
              }}
            >
              {data.kind}
            </Typography>
            {data.namespace && (
              <Typography
                component="span"
                variant="caption"
                title={`Namespace: ${data.namespace}`}
                noWrap
                sx={{
                  display: 'block',
                  color: 'text.secondary',
                  lineHeight: `${NAMESPACE_LINE_HEIGHT}px`,
                }}
              >
                Namespace: {data.namespace}
              </Typography>
            )}
          </CardContent>
        </Box>
        {(data.status || !!data.childCount) && (
          <CardActions
            disableSpacing
            sx={{
              px: 2,
              py: 0.75,
              minHeight: 44,
              gap: 1,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <HealthIndicator status={data.status} />
            {!!data.childCount && (
              <Button
                type="button"
                size="small"
                aria-label={`${data.collapsed ? 'Expand' : 'Collapse'} children of ${resourceName}`}
                aria-expanded={!data.collapsed}
                title={`${data.collapsed ? 'Expand' : 'Collapse'} ${data.childCount} child ${
                  data.childCount === 1 ? 'resource' : 'resources'
                } of ${resourceName}`}
                onClick={() => data.onToggleCollapse?.(id)}
                sx={{
                  ml: 'auto',
                  p: 0.5,
                  minWidth: 40,
                  height: 32,
                  gap: 0.25,
                  flexShrink: 0,
                  borderRadius: 0.5,
                  backgroundColor: 'action.hover',
                  color: 'text.secondary',
                  fontSize: 12,
                  '&:hover': { backgroundColor: 'action.selected' },
                  '&.Mui-focusVisible': {
                    outline: `2px solid ${theme.palette.primary.main}`,
                    outlineOffset: 2,
                  },
                }}
              >
                <Box
                  component="span"
                  aria-hidden="true"
                  sx={{
                    display: 'flex',
                    transform: data.collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                    transition: theme.transitions.create('transform', {
                      duration: theme.transitions.duration.shortest,
                    }),
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                  }}
                >
                  <Icon icon="mdi:chevron-right" width={16} height={16} />
                </Box>
                {data.childCount}
              </Button>
            )}
          </CardActions>
        )}
      </Card>
      <Handle type="source" position={Position.Bottom} style={handleStyle} isConnectable={false} />
    </>
  );
}

/**
 * Health indicator inside a node: binary Ready / Not Ready from the
 * upstream-derived status, as bare icon + text (no chip shell). A failure is
 * important information, so "Not Ready" carries the error color on both icon and
 * text to catch the eye; "Ready" stays calm in secondary text so a healthy graph
 * reads quiet (Refactoring UI, "Size isn't everything" — emphasize by weight and
 * color, de-emphasize the resting state).
 */
function HealthIndicator({ status }: { status?: 'success' | 'error' }) {
  const theme = useTheme();
  if (!status) return null;
  const ok = status === 'success';
  const errorColor = theme.palette.mode === 'dark' ? colors.red[200] : theme.palette.error.main;
  const textColor = ok ? theme.palette.text.secondary : errorColor;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Icon
        icon={ok ? 'mdi:check-circle' : 'mdi:alert-circle'}
        width={14}
        height={14}
        // Iconify 3's color prop mutates React-frozen styles when the icon updates.
        style={{
          display: 'block',
          flexShrink: 0,
          color: ok ? theme.palette.success.main : errorColor,
        }}
      />
      <Typography
        variant="caption"
        component="span"
        sx={{
          ...TRIMMED_TEXT_SX,
          fontWeight: 600,
          color: textColor,
        }}
      >
        {ok ? 'Ready' : 'Not Ready'}
      </Typography>
    </Box>
  );
}
