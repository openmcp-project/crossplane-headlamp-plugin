import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const passthrough = ({ children }: any) => children ?? null;
  (globalThis as any).window.pluginLib = {
    MuiCore: {
      Typography: passthrough,
      Box: passthrough,
      Paper: passthrough,
      CircularProgress: () => null,
      Chip: ({ label }: any) => label,
    },
  };
  return { openCRDDetailByGroupPlural: vi.fn() };
});

vi.mock('../common/Resources', () => ({
  Composition: { useList: () => [[], null] },
  CompositeResourceDefinition: {
    useList: () => [
      [
        {
          metadata: { name: 'webservices.platform.example.org' },
          jsonData: {
            spec: {
              group: 'platform.example.org',
              names: { kind: 'WebService', plural: 'webservices' },
            },
            status: { conditions: [{ type: 'Established', status: 'True' }] },
          },
        },
      ],
      null,
    ],
  },
}));
vi.mock('../crds/CRDList', () => ({
  openCRDDetailByGroupPlural: mocks.openCRDDetailByGroupPlural,
}));

import CompositionList from './index';

afterEach(cleanup);

it('opens the XR instances of an XRD when its row is clicked', () => {
  render(<CompositionList />);
  fireEvent.click(screen.getByText('webservices.platform.example.org'));
  expect(mocks.openCRDDetailByGroupPlural).toHaveBeenCalledWith(
    'platform.example.org',
    'webservices'
  );
});
