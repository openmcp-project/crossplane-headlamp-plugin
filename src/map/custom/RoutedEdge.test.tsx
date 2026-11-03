import { cleanup, render, screen } from '@testing-library/react';
import { Edge, EdgeProps, Position, XYPosition } from '@xyflow/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EdgeRoute } from './layoutGraph';
import { RoutedEdge } from './RoutedEdge';

const originalBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
beforeAll(() => {
  // JSDOM does not measure SVG text; keep the real BaseEdge and EdgeText components.
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 30, height: 12 }),
  });
});
afterEach(cleanup);
afterAll(() => {
  if (originalBBox) Object.defineProperty(SVGElement.prototype, 'getBBox', originalBBox);
  else Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
});

function edgeProps(points: XYPosition[]): EdgeProps<Edge<EdgeRoute>> {
  return {
    id: 'relationship',
    source: 'parent',
    target: 'child',
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    sourceX: points[0].x,
    sourceY: points[0].y,
    targetX: points[points.length - 1].x,
    targetY: points[points.length - 1].y,
    data: { id: 'relationship', source: 'parent', target: 'child', points },
  };
}

describe('routed edge rendering', () => {
  it.each([
    {
      name: 'a rounded corner',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 200, y: 100 },
      ],
      path: 'M 0 0 L 0 92 Q 0 100 8 100 L 200 100',
    },
    {
      name: 'a collinear interior point',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 0, y: 200 },
      ],
      path: 'M 0 0 L 0 92 Q 0 100 0 108 L 0 200',
    },
    {
      name: 'coincident corners without cutting diagonally across the obstacle',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 0, y: 100 },
        { x: 200, y: 100 },
      ],
      path: 'M 0 0 L 0 100 L 0 100 L 200 100',
    },
    {
      name: 'a route with only its endpoints',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 200 },
      ],
      path: 'M 0 0 L 0 200',
    },
  ])('renders $name', ({ points, path }) => {
    const { container } = render(
      <svg>
        <RoutedEdge {...edgeProps(points)} />
      </svg>
    );
    expect(container.querySelector('.react-flow__edge-path')!.getAttribute('d')).toBe(path);
    expect(container.querySelector('.react-flow__edge-interaction')!.getAttribute('d')).toBe(path);
  });

  it('extends vertical terminal segments to the measured handles while retaining interior bends', () => {
    const props = edgeProps([
      { x: 132, y: 156 },
      { x: 132, y: 208 },
      { x: 432, y: 208 },
      { x: 432, y: 316 },
    ]);
    const { container } = render(
      <svg>
        <RoutedEdge {...props} sourceY={138} targetY={296} />
      </svg>
    );
    expect(container.querySelector('.react-flow__edge-path')!.getAttribute('d')).toBe(
      'M 132 138 L 132 200 Q 132 208 140 208 L 424 208 Q 432 208 432 216 L 432 296'
    );
  });

  it('renders the inferred label at its layout position and preserves the arrow and dashed style', () => {
    const props = edgeProps([
      { x: 164, y: 156 },
      { x: 164, y: 400 },
    ]);
    const { container } = render(
      <svg>
        <RoutedEdge
          {...props}
          data={{ ...props.data!, aux: true, labelPosition: { x: 190, y: 278 } }}
          sourceY={138}
          label="infers"
          labelShowBg
          labelBgPadding={[8, 4]}
          labelBgBorderRadius={6}
          markerStart="url(#arrow)"
          style={{ stroke: '#888', strokeWidth: 1.5, strokeDasharray: '6 4', opacity: 0.6 }}
        />
      </svg>
    );
    const path = container.querySelector<SVGPathElement>('.react-flow__edge-path')!;
    expect(path.getAttribute('marker-start')).toBe('url(#arrow)');
    expect(path.style.strokeDasharray).toBe('6 4');
    expect(path.style.opacity).toBe('0.6');
    const label = screen.getByText('infers').parentElement!;
    expect(label.getAttribute('transform')).toBe('translate(175 272)');
    expect(label.getAttribute('visibility')).toBe('visible');
    const background = label.querySelector('rect')!;
    expect(background.getAttribute('width')).toBe('46');
    expect(background.getAttribute('height')).toBe('20');
    expect(background.getAttribute('rx')).toBe('6');
  });
});
