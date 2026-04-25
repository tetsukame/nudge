// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProgressBar } from '../../../src/ui/components/progress-bar';

describe('ProgressBar', () => {
  it('renders with correct width segments', () => {
    const { container } = render(
      <ProgressBar
        counts={{ unopened: 2, opened: 1, responded: 5, unavailable: 1, other: 1 }}
        total={10}
      />,
    );
    const segments = container.querySelectorAll('[style*="width"]');
    expect(segments.length).toBeGreaterThan(0);
  });

  it('renders empty bar when total is 0', () => {
    const { container } = render(
      <ProgressBar
        counts={{ unopened: 0, opened: 0, responded: 0, unavailable: 0, other: 0 }}
        total={0}
      />,
    );
    expect(container.querySelector('.bg-gray-200')).toBeTruthy();
  });
});
