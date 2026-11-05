import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Node, ViewportPortal } from '@xyflow/react';

const DASH_LENGTH = 6;
const GAP_LENGTH = 4;
const DASH_PERIOD = DASH_LENGTH + GAP_LENGTH;

export function GroupPreview({
  nodes,
  targetId,
  reduceMotion,
}: {
  nodes: Node[];
  targetId: string;
  reduceMotion: boolean;
}) {
  const theme = useTheme();
  const cards = nodes.flatMap(node => {
    const { width, height } = node.measured ?? {};
    if (node.hidden || !width || !height) return [];
    return [
      {
        id: node.id,
        x: node.position.x + width / 2,
        y: node.position.y + height / 2,
        // Meet the outside of the 2px outline, which sits 3px away from the card.
        halfWidth: width / 2 + 5,
        halfHeight: height / 2 + 5,
      },
    ];
  });

  const target = cards.find(card => card.id === targetId);
  if (!target || cards.length < 2) return null;

  return (
    <ViewportPortal>
      <Box
        component="svg"
        className="crossplane-group-preview"
        aria-hidden="true"
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 1,
          height: 1,
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: 2,
          fill: 'none',
          stroke: theme.palette.primary.main,
          strokeWidth: 2,
          strokeDasharray: `${DASH_LENGTH} ${GAP_LENGTH}`,
          '& path': {
            animation: reduceMotion ? 'none' : 'crossplane-group-dash 1s linear infinite',
          },
          '@keyframes crossplane-group-dash': {
            from: { strokeDashoffset: 0 },
            to: { strokeDashoffset: -DASH_PERIOD },
          },
        }}
      >
        {cards
          .filter(card => card.id !== targetId)
          .map(source => {
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const sourceInsetFraction = Math.min(
              source.halfWidth / Math.abs(dx),
              source.halfHeight / Math.abs(dy)
            );
            const targetInsetFraction = Math.min(
              target.halfWidth / Math.abs(dx),
              target.halfHeight / Math.abs(dy)
            );
            if (sourceInsetFraction + targetInsetFraction >= 1) return null;
            const length = Math.hypot(dx, dy) * (1 - sourceInsetFraction - targetInsetFraction);
            return (
              <path
                key={`${source.id}:${target.id}`}
                d={
                  `M ${source.x + dx * sourceInsetFraction} ${
                    source.y + dy * sourceInsetFraction
                  } ` +
                  `L ${target.x - dx * targetInsetFraction} ${target.y - dy * targetInsetFraction}`
                }
                // Align dashes at the target so overlapping sibling paths keep their gaps.
                strokeDashoffset={-length}
                style={{ animationDelay: `${-(length % DASH_PERIOD) / DASH_PERIOD}s` }}
              />
            );
          })}
      </Box>
    </ViewportPortal>
  );
}
