// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssigneeListFilters } from '../../../src/ui/components/assignee-list-filters';

// Mock fetch for org-tree
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve([]),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssigneeListFilters Clear button', () => {
  it('clear button is hidden when no filter is set', async () => {
    const onChange = vi.fn();
    render(<AssigneeListFilters tenantCode="dev" onChange={onChange} />);
    expect(screen.queryByRole('button', { name: 'クリア' })).toBeNull();
  });

  it('clear button appears when search query is entered', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AssigneeListFilters tenantCode="dev" onChange={onChange} />);
    const searchInput = screen.getByPlaceholderText(/名前.*メール/);
    await user.type(searchInput, 'tanaka');
    expect(screen.getByRole('button', { name: 'クリア' })).toBeDefined();
  });

  it('clear button appears when status is toggled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AssigneeListFilters tenantCode="dev" onChange={onChange} />);
    const responseButton = screen.getByRole('button', { name: '対応済み' });
    await user.click(responseButton);
    expect(screen.getByRole('button', { name: 'クリア' })).toBeDefined();
  });

  it('clicking clear resets all filters and disappears', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AssigneeListFilters tenantCode="dev" onChange={onChange} />);
    // Set some filters
    const searchInput = screen.getByPlaceholderText(/名前.*メール/);
    await user.type(searchInput, 'test');
    await user.click(screen.getByRole('button', { name: '対応済み' }));
    // Clear button should now be visible
    const clearButton = screen.getByRole('button', { name: 'クリア' });
    expect(clearButton).toBeDefined();
    // Click clear
    await user.click(clearButton);
    // Inputs should be reset
    expect((searchInput as HTMLInputElement).value).toBe('');
    // Status button should not be in active state (the active state has bg-blue-100 class)
    const responseButton = screen.getByRole('button', { name: '対応済み' });
    expect(responseButton.className).not.toContain('bg-blue-100');
    // Clear button should disappear
    expect(screen.queryByRole('button', { name: 'クリア' })).toBeNull();
  });
});
