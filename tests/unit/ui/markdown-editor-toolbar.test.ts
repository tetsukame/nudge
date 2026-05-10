import { describe, it, expect } from 'vitest';
import {
  insertBold,
  insertHeading,
  insertBulletList,
  insertNumberedList,
  insertLink,
  insertCode,
  continueList,
} from '../../../src/ui/components/markdown-editor-toolbar';

describe('markdown-editor-toolbar helpers', () => {
  describe('insertBold', () => {
    it('wraps the selection with **', () => {
      const r = insertBold('hello world', { start: 6, end: 11 });
      expect(r.value).toBe('hello **world**');
      expect(r.selection).toEqual({ start: 6, end: 15 });
    });

    it('inserts placeholder when no selection, places cursor inside', () => {
      const r = insertBold('foo bar', { start: 4, end: 4 });
      expect(r.value).toBe('foo **太字**bar');
      expect(r.selection).toEqual({ start: 6, end: 8 });
    });

    it('handles empty value', () => {
      const r = insertBold('', { start: 0, end: 0 });
      expect(r.value).toBe('**太字**');
      expect(r.selection).toEqual({ start: 2, end: 4 });
    });
  });

  describe('insertHeading', () => {
    it('prepends ## to a single-line selection', () => {
      const r = insertHeading('foo\nbar baz\nqux', { start: 4, end: 11 });
      expect(r.value).toBe('foo\n## bar baz\nqux');
      expect(r.selection).toEqual({ start: 4, end: 14 });
    });

    it('prepends ## to current line when no selection', () => {
      const r = insertHeading('foo\nbar\nqux', { start: 5, end: 5 });
      expect(r.value).toBe('foo\n## bar\nqux');
      expect(r.selection).toEqual({ start: 8, end: 8 });
    });

    it('removes ## prefix when toggled on a line that already has it', () => {
      const r = insertHeading('## hello', { start: 5, end: 5 });
      expect(r.value).toBe('hello');
      expect(r.selection).toEqual({ start: 2, end: 2 });
    });

    it('handles cursor at start of line', () => {
      const r = insertHeading('hello', { start: 0, end: 0 });
      expect(r.value).toBe('## hello');
      expect(r.selection).toEqual({ start: 3, end: 3 });
    });
  });

  describe('insertBulletList', () => {
    it('prepends "- " to a single line when no selection', () => {
      const r = insertBulletList('hello', { start: 3, end: 3 });
      expect(r.value).toBe('- hello');
      expect(r.selection).toEqual({ start: 5, end: 5 });
    });

    it('prepends "- " to each line of a multi-line selection', () => {
      const r = insertBulletList('a\nb\nc', { start: 0, end: 5 });
      expect(r.value).toBe('- a\n- b\n- c');
      expect(r.selection).toEqual({ start: 0, end: 11 });
    });

    it('toggles off when current line already has "- " prefix', () => {
      const r = insertBulletList('- hello', { start: 4, end: 4 });
      expect(r.value).toBe('hello');
      expect(r.selection).toEqual({ start: 2, end: 2 });
    });

    it('does not toggle when only some lines have prefix (turns all on)', () => {
      const r = insertBulletList('- a\nb', { start: 0, end: 5 });
      expect(r.value).toBe('- a\n- b');
      expect(r.selection.end).toBe(7);
    });
  });

  describe('insertNumberedList', () => {
    it('prepends "1. " to a single line', () => {
      const r = insertNumberedList('hello', { start: 3, end: 3 });
      expect(r.value).toBe('1. hello');
    });

    it('prepends sequential numbers to multi-line selection', () => {
      const r = insertNumberedList('a\nb\nc', { start: 0, end: 5 });
      expect(r.value).toBe('1. a\n2. b\n3. c');
    });

    it('toggles off when line already has "N. " prefix', () => {
      const r = insertNumberedList('1. hello', { start: 5, end: 5 });
      expect(r.value).toBe('hello');
      expect(r.selection).toEqual({ start: 2, end: 2 });
    });
  });

  describe('insertLink', () => {
    it('wraps selection as [selection](url)', () => {
      const r = insertLink('see google', { start: 4, end: 10 }, 'https://google.com');
      expect(r).not.toBeNull();
      expect(r!.value).toBe('see [google](https://google.com)');
    });

    it('inserts [リンク](url) placeholder when no selection', () => {
      const r = insertLink('see ', { start: 4, end: 4 }, 'https://x.com');
      expect(r).not.toBeNull();
      expect(r!.value).toBe('see [リンク](https://x.com)');
      // cursor should land on the placeholder text "リンク" so the user can type to replace
      expect(r!.selection).toEqual({ start: 5, end: 8 });
    });

    it('returns null when url is empty (caller can short-circuit)', () => {
      const r = insertLink('hello', { start: 0, end: 5 }, '');
      expect(r).toBeNull();
    });
  });

  describe('continueList', () => {
    it('continues "- " on Enter at end of bullet list line', () => {
      const value = '- first';
      const r = continueList(value, { start: 7, end: 7 });
      expect(r).not.toBeNull();
      expect(r!.value).toBe('- first\n- ');
      expect(r!.selection).toEqual({ start: 10, end: 10 });
    });

    it('continues with incremented number on Enter at end of numbered list line', () => {
      const value = '1. first';
      const r = continueList(value, { start: 8, end: 8 });
      expect(r).not.toBeNull();
      expect(r!.value).toBe('1. first\n2. ');
      expect(r!.selection).toEqual({ start: 12, end: 12 });
    });

    it('exits list when Enter is pressed on an empty bullet item', () => {
      const value = '- first\n- ';
      const r = continueList(value, { start: 10, end: 10 });
      expect(r).not.toBeNull();
      // The empty "- " line is removed entirely (prefix stripped)
      expect(r!.value).toBe('- first\n');
      expect(r!.selection).toEqual({ start: 8, end: 8 });
    });

    it('exits list when Enter is pressed on an empty numbered item', () => {
      const value = '1. first\n2. ';
      const r = continueList(value, { start: 12, end: 12 });
      expect(r).not.toBeNull();
      expect(r!.value).toBe('1. first\n');
      expect(r!.selection).toEqual({ start: 9, end: 9 });
    });

    it('returns null on non-list lines', () => {
      const r = continueList('hello world', { start: 11, end: 11 });
      expect(r).toBeNull();
    });

    it('returns null when there is a selection (range)', () => {
      const r = continueList('- foo\n- bar', { start: 2, end: 5 });
      expect(r).toBeNull();
    });

    it('handles indented bullet lists', () => {
      const value = '  - first';
      const r = continueList(value, { start: 9, end: 9 });
      expect(r).not.toBeNull();
      expect(r!.value).toBe('  - first\n  - ');
    });

    it('continues numbering correctly even mid-document', () => {
      const value = 'intro\n1. one\n2. two\n3. three';
      const r = continueList(value, { start: 19, end: 19 }); // end of "2. two"
      expect(r).not.toBeNull();
      expect(r!.value).toBe('intro\n1. one\n2. two\n3. \n3. three');
    });
  });

  describe('insertCode', () => {
    it('wraps single-line selection with backticks (inline)', () => {
      const r = insertCode('say hello', { start: 4, end: 9 });
      expect(r.value).toBe('say `hello`');
    });

    it('wraps multi-line selection with code fence', () => {
      const r = insertCode('a\nb\nc', { start: 0, end: 5 });
      expect(r.value).toBe('```\na\nb\nc\n```');
    });

    it('inserts inline placeholder when no selection (single-cursor)', () => {
      const r = insertCode('foo ', { start: 4, end: 4 });
      expect(r.value).toBe('foo `code`');
      expect(r.selection).toEqual({ start: 5, end: 9 });
    });
  });
});
