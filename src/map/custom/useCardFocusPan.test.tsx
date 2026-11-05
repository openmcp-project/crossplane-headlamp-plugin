import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCardFocusPan } from './useCardFocusPan';

const flow = vi.hoisted(() => ({
  position: { x: 500, y: 300 },
  viewport: { x: -80, y: -40, zoom: 1.5 },
  width: 600,
  height: 300,
  keyboardFocus: true,
  nativeScroll: { x: 0, y: 0 },
  setCenter: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({
    getInternalNode: () => ({ internals: { positionAbsolute: flow.position } }),
    getViewport: () => flow.viewport,
    setCenter: flow.setCenter,
  }),
}));

beforeEach(() => {
  flow.position = { x: 500, y: 300 };
  flow.viewport = { x: -80, y: -40, zoom: 1.5 };
  flow.width = 600;
  flow.height = 300;
  flow.keyboardFocus = true;
  flow.nativeScroll = { x: 0, y: 0 };
  flow.setCenter.mockReset().mockImplementation((x, y, { zoom }) => {
    flow.viewport = { x: flow.width / 2 - x * zoom, y: flow.height / 2 - y * zoom, zoom };
    return Promise.resolve(true);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Card() {
  const handleFocus = useCardFocusPan('card');
  return (
    <div className="react-flow" data-testid="canvas">
      <div onFocus={handleFocus} data-testid="card">
        <button type="button">Group resources</button>
        <button type="button">Collapse children</button>
      </div>
    </div>
  );
}

function renderCard() {
  render(<Card />);
  const canvas = screen.getByTestId('canvas');
  const card = screen.getByTestId('card');
  const group = screen.getByRole('button', { name: 'Group resources' });
  const collapse = screen.getByRole('button', { name: 'Collapse children' });
  Object.defineProperties(canvas, {
    clientWidth: { get: () => flow.width },
    clientHeight: { get: () => flow.height },
  });
  Object.defineProperties(card, {
    offsetWidth: { value: 264 },
    offsetHeight: { value: 130 },
  });
  vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(120, 80, flow.width, flow.height)
  );
  vi.spyOn(card, 'getBoundingClientRect').mockImplementation(
    () =>
      new DOMRect(
        120 + flow.position.x * flow.viewport.zoom + flow.viewport.x - flow.nativeScroll.x,
        80 + flow.position.y * flow.viewport.zoom + flow.viewport.y - flow.nativeScroll.y,
        264 * flow.viewport.zoom,
        130 * flow.viewport.zoom
      )
  );
  for (const [button, x] of [
    [group, 180],
    [collapse, 220],
  ] as const) {
    vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() => {
      const { zoom } = flow.viewport;
      return new DOMRect(
        120 + (flow.position.x + x) * zoom + flow.viewport.x - flow.nativeScroll.x,
        80 + (flow.position.y + 98) * zoom + flow.viewport.y - flow.nativeScroll.y,
        32 * zoom,
        32 * zoom
      );
    });
    const matches = button.matches.bind(button);
    // JSDOM does not track keyboard/pointer modality; retain real DOM focus events.
    vi.spyOn(button, 'matches').mockImplementation(selector =>
      selector === ':focus-visible'
        ? flow.keyboardFocus && document.activeElement === button
        : matches(selector)
    );
  }
  return { group, collapse, canvas };
}

it('centers an off-screen card that fits the canvas and preserves zoom', () => {
  const { collapse } = renderCard();
  act(() => collapse.focus());

  expect(document.activeElement).toBe(collapse);
  expect(flow.setCenter).toHaveBeenCalledExactlyOnceWith(632, 365, { zoom: 1.5 });
});

it('leaves the viewport unchanged when the whole card is already visible', () => {
  flow.position = { x: 100, y: 60 };
  const viewport = { ...flow.viewport };
  const { collapse } = renderCard();
  act(() => collapse.focus());

  expect(flow.setCenter).not.toHaveBeenCalled();
  expect(flow.viewport).toEqual(viewport);
});

it.each([
  { width: 600, height: 300 },
  { width: 600, height: 700 },
  { width: 1200, height: 300 },
])('centers the focused action when the card exceeds a $width × $height canvas', dimensions => {
  flow.width = dimensions.width;
  flow.height = dimensions.height;
  flow.viewport.zoom = 4;
  const { collapse } = renderCard();
  act(() => collapse.focus());

  expect(flow.setCenter).toHaveBeenCalledExactlyOnceWith(736, 414, { zoom: 4 });
});

it('follows successive action focus on an oversized card', () => {
  flow.viewport.zoom = 4;
  const { group, collapse } = renderCard();
  act(() => group.focus());
  act(() => collapse.focus());

  expect(document.activeElement).toBe(collapse);
  expect(flow.setCenter).toHaveBeenCalledTimes(2);
  expect(flow.setCenter).toHaveBeenNthCalledWith(1, 696, 414, { zoom: 4 });
  expect(flow.setCenter).toHaveBeenNthCalledWith(2, 736, 414, { zoom: 4 });
});

it('accounts for native focus scrolling before React Flow resets the canvas', () => {
  flow.viewport.zoom = 4;
  flow.nativeScroll = { x: 2400, y: 1500 };
  const { collapse } = renderCard();
  act(() => collapse.focus());

  expect(flow.setCenter).toHaveBeenCalledExactlyOnceWith(736, 414, { zoom: 4 });
});

it('does not pan for pointer focus without a visible focus indicator', () => {
  flow.keyboardFocus = false;
  const { collapse } = renderCard();
  act(() => collapse.focus());

  expect(document.activeElement).toBe(collapse);
  expect(flow.setCenter).not.toHaveBeenCalled();
});
