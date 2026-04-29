// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownEditor } from '../../../src/ui/components/markdown-editor';

describe('MarkdownEditor', () => {
  it('renders edit textarea by default with current value', () => {
    render(<MarkdownEditor value="hello" onChange={() => {}} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('hello');
  });

  it('calls onChange when textarea is edited', () => {
    const handle = vi.fn();
    render(<MarkdownEditor value="" onChange={handle} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '# heading' } });
    expect(handle).toHaveBeenCalledWith('# heading');
  });

  it('switches to preview tab and renders Markdown', () => {
    render(<MarkdownEditor value={'# 見出し\n- 項目'} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'プレビュー' }));
    expect(screen.getByText('見出し')).toBeDefined();
    expect(screen.getByText('項目')).toBeDefined();
  });

  it('shows empty placeholder in preview when value is empty', () => {
    render(<MarkdownEditor value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'プレビュー' }));
    expect(screen.getByText('プレビューする内容がありません。')).toBeDefined();
  });

  it('switches back from preview to edit', () => {
    render(<MarkdownEditor value="text" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'プレビュー' }));
    fireEvent.click(screen.getByRole('button', { name: '編集' }));
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('renders Markdown cheatsheet at the bottom', () => {
    render(<MarkdownEditor value="" onChange={() => {}} />);
    expect(screen.getByText(/Markdown 記法:/)).toBeDefined();
    expect(screen.getByText(/見出し/)).toBeDefined();
    expect(screen.getByText(/箇条書き/)).toBeDefined();
  });
});
