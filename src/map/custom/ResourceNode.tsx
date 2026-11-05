import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  IconButton,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Handle, Node, NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import {
  AUX_HANDLE_OFFSET,
  CATEGORY_SWATCH_SX,
  getCardActionSx,
  NAMESPACE_LINE_HEIGHT,
  NODE_WIDTH,
  TRIMMED_TEXT_SX,
} from './styles';
import { useCardFocusPan } from './useCardFocusPan';

export type ResourceNodeData = {
  kind: string;
  name: string;
  namespace?: string;
  // Resolved color for the active category mode; undefined = uncategorized (mode "none").
  color?: string;
  // Display text is separate from the category key so missing values have a readable label.
  categoryLabel?: string;
  // Ready-and-synced health, derived upstream in the graph source.
  status?: 'success' | 'error';
  childNodeCount?: number;
  collapsed?: boolean;
  candidateMemberCount?: number;
  groupHighlighted?: boolean;
  onGroup?: () => void;
  onGroupMouseEnter?: () => void;
  onGroupMouseLeave?: () => void;
  onOpenDetails?: () => void;
  onToggleCollapse?: (id: string) => void;
};

/**
 * A single resource card. Themed via MUI so it follows Headlamp's light/dark
 * palette; React Flow supplies `selected`, which drives the accent border.
 * Handles sit top/bottom to match the top-down ELK layout.
 */
export function ResourceNode({ id, data, selected }: NodeProps<Node<ResourceNodeData>>) {
  return <ResourceCard id={id} data={data} selected={selected} />;
}

const ResourceCard = memo(function ResourceCard({
  id,
  data,
  selected,
}: Pick<NodeProps<Node<ResourceNodeData>>, 'id' | 'data' | 'selected'>) {
  const theme = useTheme();
  const handleFocus = useCardFocusPan(id);
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
  const isError = data.status === 'error';
  const resourceName = data.namespace ? `${data.namespace}/${data.name}` : data.name;
  const collapseLabel = `${data.collapsed ? 'Expand' : 'Collapse'} children of ${resourceName}`;
  const groupLabel = `Group ${data.candidateMemberCount ? `${data.candidateMemberCount} ` : ''}${
    data.kind
  } resources with ${resourceName}`;

  return (
    <>
      <Handle
        id="target"
        type="target"
        position={Position.Top}
        style={handleStyle}
        isConnectable={false}
      />
      <Handle
        id="aux-target"
        type="target"
        position={Position.Top}
        style={{ ...handleStyle, left: NODE_WIDTH / 2 + AUX_HANDLE_OFFSET }}
        isConnectable={false}
      />
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
          outline: data.groupHighlighted ? `2px dashed ${theme.palette.primary.main}` : undefined,
          outlineOffset: 3,
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
              pt: 1.5,
              pb: 0.75,
              '&:last-child': { pb: 0.75 },
            }}
          >
            {data.categoryLabel && (
              <Box
                component="span"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  mb: 0.75,
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
        {(data.status || data.onToggleCollapse || data.onGroup) && (
          <CardActions
            disableSpacing
            sx={{
              px: 2,
              py: 0.25,
              minHeight: 40,
              gap: 0.5,
              borderTop: 1,
              borderColor: isError ? 'error.main' : 'divider',
              backgroundColor: isError ? 'error.main' : undefined,
              color: isError ? 'error.contrastText' : 'text.secondary',
            }}
          >
            <HealthIndicator status={data.status} />
            {data.onGroup && (
              <IconButton
                type="button"
                size="small"
                color="inherit"
                aria-label={groupLabel}
                title={groupLabel}
                onClick={data.onGroup}
                onMouseEnter={data.onGroupMouseEnter}
                onMouseLeave={data.onGroupMouseLeave}
                sx={{
                  ...getCardActionSx(theme, isError ? theme.palette.error : undefined),
                  ml: 'auto',
                  p: 0.5,
                  width: 32,
                  height: 32,
                }}
              >
                <Icon icon="mdi:group" width={16} height={16} aria-hidden="true" />
              </IconButton>
            )}
            {data.onToggleCollapse && (
              <Button
                type="button"
                size="small"
                variant="text"
                color="inherit"
                aria-label={collapseLabel}
                aria-expanded={!data.collapsed}
                title={
                  data.childNodeCount
                    ? `${data.collapsed ? 'Expand' : 'Collapse'} ${data.childNodeCount} child ${
                        data.childNodeCount === 1 ? 'node' : 'nodes'
                      } of ${resourceName}`
                    : collapseLabel
                }
                onClick={() => data.onToggleCollapse?.(id)}
                sx={{
                  ...getCardActionSx(theme, isError ? theme.palette.error : undefined),
                  ml: data.onGroup ? 0 : 'auto',
                  p: 0.5,
                  minWidth: 32,
                  height: 32,
                  gap: 0.25,
                  fontSize: 12,
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
                {data.childNodeCount}
              </Button>
            )}
          </CardActions>
        )}
      </Card>
      <Handle
        id="source"
        type="source"
        position={Position.Bottom}
        style={handleStyle}
        isConnectable={false}
      />
      <Handle
        id="aux-source"
        type="source"
        position={Position.Bottom}
        style={{ ...handleStyle, left: NODE_WIDTH / 2 + AUX_HANDLE_OFFSET }}
        isConnectable={false}
      />
    </>
  );
});

function HealthIndicator({ status }: { status?: 'success' | 'error' }) {
  const theme = useTheme();
  if (!status) return null;
  const isHealthy = status === 'success';
  const label = isHealthy ? 'Healthy' : 'Needs Attention';

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <Icon
        icon={isHealthy ? 'mdi:check-circle' : 'mdi:alert-circle'}
        width={14}
        height={14}
        // Iconify 3's color prop mutates React-frozen styles when the icon updates.
        style={{
          display: 'block',
          flexShrink: 0,
          color: isHealthy ? theme.palette.success.main : 'inherit',
        }}
      />
      <Typography
        variant="caption"
        component="span"
        title={label}
        sx={{
          ...TRIMMED_TEXT_SX,
          fontWeight: 600,
          color: 'inherit',
          minWidth: 0,
          whiteSpace: 'nowrap',
          // Clip horizontally without cutting off trimmed glyphs above or below the box.
          overflowX: 'clip',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}
