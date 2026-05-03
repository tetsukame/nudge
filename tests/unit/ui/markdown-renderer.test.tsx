// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownRenderer } from '../../../src/ui/components/markdown-renderer';

describe('MarkdownRenderer', () => {
  it('renders headings', () => {
    render(<MarkdownRenderer body={'# H1 タイトル'} />);
    expect(screen.getByText('H1 タイトル')).toBeDefined();
  });

  it('renders bullet lists', () => {
    render(<MarkdownRenderer body={'- 項目1\n- 項目2'} />);
    expect(screen.getByText('項目1')).toBeDefined();
    expect(screen.getByText('項目2')).toBeDefined();
  });

  it('renders inline code and code blocks', () => {
    const { container } = render(
      <MarkdownRenderer body={'`inline` の後に\n\n```\nblock code\n```'} />,
    );
    expect(container.querySelector('code')).toBeDefined();
    expect(container.querySelector('pre')).toBeDefined();
  });

  it('renders external links with rel and target', () => {
    const { container } = render(
      <MarkdownRenderer body={'[example](https://example.com)'} />,
    );
    const a = container.querySelector('a');
    expect(a).toBeDefined();
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  it('autolinks bare URLs in body text', () => {
    const { container } = render(
      <MarkdownRenderer body={'参考: https://example.com/docs を確認してください'} />,
    );
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('https://example.com/docs');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
    expect(a?.textContent).toBe('https://example.com/docs');
  });

  it('autolinks multiple bare URLs separately', () => {
    const { container } = render(
      <MarkdownRenderer body={'A: https://example.com/a と B: https://example.com/b'} />,
    );
    const links = container.querySelectorAll('a');
    expect(links.length).toBe(2);
    expect(links[0]?.getAttribute('href')).toBe('https://example.com/a');
    expect(links[1]?.getAttribute('href')).toBe('https://example.com/b');
  });

  it('does not render raw <script> tags', () => {
    // react-markdown disables raw HTML by default; rehype-sanitize is a
    // belt-and-suspenders layer. Verify no <script> element is created.
    const { container } = render(
      <MarkdownRenderer body={'normal text\n\n<script>alert("xss")</script>'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('normal text');
  });

  it('renders GFM tables', () => {
    const md = '| 列1 | 列2 |\n| --- | --- |\n| a | b |';
    const { container } = render(<MarkdownRenderer body={md} />);
    expect(container.querySelector('table')).toBeDefined();
    expect(screen.getByText('列1')).toBeDefined();
    expect(screen.getByText('a')).toBeDefined();
  });

  it('handles empty body without crashing', () => {
    const { container } = render(<MarkdownRenderer body="" />);
    expect(container.firstChild).toBeDefined();
  });
});
