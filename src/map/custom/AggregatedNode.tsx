import { Icon } from '@iconify/react';
import { Box, Button, Card, CardActions, CardContent, IconButton, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Handle, Node, NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import {
  AGGREGATED_NODE_HEIGHT,
  AUX_HANDLE_OFFSET,
  getCardActionSx,
  NODE_WIDTH,
  TRIMMED_TEXT_SX,
} from './styles';
import { useCardFocusPan } from './useCardFocusPan';

export type AggregatedNodeData = {
  kind: string;
  apiGroup?: string;
  memberCount: number;
  healthyMemberCount: number;
  childNodeCount?: number;
  collapsed?: boolean;
  onToggleCollapse?: (id: string) => void;
  candidateMemberCount?: number;
  groupHighlighted?: boolean;
  onGroup?: () => void;
  onGroupMouseEnter?: () => void;
  onGroupMouseLeave?: () => void;
  onUngroup: () => void;
};

export function AggregatedNode({ id, data }: NodeProps<Node<AggregatedNodeData>>) {
  return <AggregatedCard id={id} data={data} />;
}

const AggregatedCard = memo(function AggregatedCard({
  id,
  data,
}: Pick<NodeProps<Node<AggregatedNodeData>>, 'id' | 'data'>) {
  const theme = useTheme();
  const handleFocus = useCardFocusPan(id);
  const allHealthy = data.healthyMemberCount === data.memberCount;
  const allUnhealthy = data.healthyMemberCount === 0;
  const healthLabel = `${allUnhealthy ? data.memberCount : data.healthyMemberCount} of ${
    data.memberCount
  } ${allUnhealthy ? 'Needs Attention' : 'Healthy'}`;
  // Headlamp's warning palette is orange; mixed health must stay visibly yellow.
  const warningColor = '#fdd835';
  const healthPalette = allHealthy
    ? undefined
    : allUnhealthy
    ? theme.palette.error
    : {
        main: warningColor,
        dark: '#fbc02d',
        contrastText: theme.palette.getContrastText(warningColor),
      };
  const groupLabel = `Group ${data.candidateMemberCount ? `${data.candidateMemberCount} ` : ''}${
    data.kind
  } resources${data.apiGroup ? ` from ${data.apiGroup}` : ''}`;
  const ungroupLabel = `Ungroup ${data.memberCount} ${data.kind} resources${
    data.apiGroup ? ` from ${data.apiGroup}` : ''
  }`;
  const collapseLabel = `${data.collapsed ? 'Expand' : 'Collapse'} children of ${
    data.memberCount
  } ${data.kind} resources${data.apiGroup ? ` from ${data.apiGroup}` : ''}`;
  const handleStyle = {
    width: 7,
    height: 7,
    transform: 'translateX(-50%)',
    opacity: 0,
  };

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
      <Box
        className="nodrag nopan"
        onDoubleClick={(event: React.MouseEvent) => event.stopPropagation()}
        onFocus={handleFocus}
        sx={{
          width: NODE_WIDTH,
          height: AGGREGATED_NODE_HEIGHT,
          position: 'relative',
          pointerEvents: 'auto',
          borderRadius: 1,
          outline: data.groupHighlighted ? `2px dashed ${theme.palette.primary.main}` : undefined,
          outlineOffset: 3,
          // The stack extends above the node; layout and edge anchors follow the front card.
          '&::before, &::after': {
            content: '""',
            position: 'absolute',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            backgroundColor: 'background.paper',
          },
          '&::before': { inset: '-8px 8px 8px' },
          '&::after': { inset: '-4px 4px 4px' },
        }}
      >
        <Card
          variant="elevation"
          elevation={1}
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          <CardContent sx={{ px: 2, pt: 1.5, pb: 1, flex: 1, minHeight: 0 }}>
            <Typography
              component="div"
              title={data.kind}
              sx={{
                fontSize: 14,
                lineHeight: '18px',
                fontWeight: 600,
                color: 'text.primary',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                overflowWrap: 'anywhere',
              }}
            >
              {data.kind}
            </Typography>
            {data.apiGroup && (
              <Typography
                component="div"
                variant="caption"
                color="text.secondary"
                title={data.apiGroup}
                noWrap
                sx={{ mt: 0.5, lineHeight: '18px' }}
              >
                {data.apiGroup}
              </Typography>
            )}
          </CardContent>
          <CardActions
            disableSpacing
            sx={{
              px: 2,
              py: 0.25,
              minHeight: 40,
              gap: 0.5,
              borderTop: 1,
              borderColor: healthPalette?.main ?? 'divider',
              backgroundColor: healthPalette?.main,
              color: healthPalette?.contrastText ?? 'text.secondary',
              flexShrink: 0,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                minWidth: 0,
              }}
            >
              <Icon
                icon={
                  allHealthy ? 'mdi:check-circle' : allUnhealthy ? 'mdi:alert-circle' : 'mdi:alert'
                }
                width={14}
                height={14}
                aria-hidden="true"
                style={{
                  display: 'block',
                  flexShrink: 0,
                  color: allHealthy ? theme.palette.success.main : 'inherit',
                }}
              />
              <Typography
                variant="caption"
                component="span"
                title={healthLabel}
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
                {healthLabel}
              </Typography>
            </Box>
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
                  ...getCardActionSx(theme, healthPalette),
                  ml: 'auto',
                  p: 0.5,
                  width: 32,
                  height: 32,
                }}
              >
                <Icon icon="mdi:group" width={16} height={16} aria-hidden="true" />
              </IconButton>
            )}
            <IconButton
              type="button"
              size="small"
              color="inherit"
              aria-label={ungroupLabel}
              title={ungroupLabel}
              onClick={data.onUngroup}
              sx={{
                ...getCardActionSx(theme, healthPalette),
                ml: data.onGroup ? 0 : 'auto',
                p: 0.5,
                width: 32,
                height: 32,
              }}
            >
              <Icon icon="mdi:ungroup" width={16} height={16} aria-hidden="true" />
            </IconButton>
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
                      } of ${data.memberCount} ${data.kind} resources${
                        data.apiGroup ? ` from ${data.apiGroup}` : ''
                      }`
                    : collapseLabel
                }
                onClick={() => data.onToggleCollapse?.(id)}
                sx={{
                  ...getCardActionSx(theme, healthPalette),
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
        </Card>
      </Box>
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
