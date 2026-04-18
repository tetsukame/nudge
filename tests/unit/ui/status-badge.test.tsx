// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../../../src/ui/components/status-badge';

describe('StatusBadge', () => {
  it('renders label and icon for responded status', () => {
    render(<StatusBadge status="responded" />);
    expect(screen.getByText('対応済み')).toBeDefined();
    expect(screen.getByText('✅')).toBeDefined();
  });

  it('shows overdue badge when overdue is true', () => {
    render(<StatusBadge status="opened" overdue />);
    expect(screen.getByText('期限超過')).toBeDefined();
  });

  it('does not show overdue badge when false', () => {
    render(<StatusBadge status="opened" overdue={false} />);
    expect(screen.queryByText('期限超過')).toBeNull();
  });

  it('renders fallback for unknown status', () => {
    render(<StatusBadge status="unknown_status" />);
    expect(screen.getByText('不明')).toBeDefined();
  });
});
