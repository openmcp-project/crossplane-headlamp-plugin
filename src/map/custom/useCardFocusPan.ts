import { useReactFlow } from '@xyflow/react';
import { FocusEvent, useCallback } from 'react';

export function useCardFocusPan(id: string) {
  const { getInternalNode, getViewport, setCenter } = useReactFlow();
  return useCallback(
    (event: FocusEvent<HTMLElement>) => {
      if (!event.target.matches(':focus-visible')) return;
      const node = getInternalNode(id);
      const viewportElement = event.currentTarget.closest('.react-flow');
      if (!node || !viewportElement) return;
      const { x, y, zoom } = getViewport();
      const position = node.internals.positionAbsolute;
      const width = event.currentTarget.offsetWidth;
      const height = event.currentTarget.offsetHeight;
      const isFullyVisible =
        position.x * zoom + x >= 0 &&
        (position.x + width) * zoom + x <= viewportElement.clientWidth &&
        position.y * zoom + y >= 0 &&
        (position.y + height) * zoom + y <= viewportElement.clientHeight;
      if (isFullyVisible) return;

      // React Flow's node-focus panning does not cover native card buttons.
      if (
        width * zoom <= viewportElement.clientWidth &&
        height * zoom <= viewportElement.clientHeight
      ) {
        void setCenter(position.x + width / 2, position.y + height / 2, { zoom });
        return;
      }

      // An oversized card cannot fit at this zoom; keep its focused control visible.
      const focusBounds = event.target.getBoundingClientRect();
      // Native focus can scroll the canvas before React Flow resets it.
      const cardBounds = event.currentTarget.getBoundingClientRect();
      void setCenter(
        position.x + (focusBounds.left - cardBounds.left + focusBounds.width / 2) / zoom,
        position.y + (focusBounds.top - cardBounds.top + focusBounds.height / 2) / zoom,
        { zoom }
      );
    },
    [id, getInternalNode, getViewport, setCenter]
  );
}
