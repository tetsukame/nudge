/**
 * Pure transformation helpers for the MarkdownEditor toolbar.
 *
 * Each helper takes the current value + selection (start/end caret positions)
 * and returns the new value + new selection. Caller (MarkdownEditor) is
 * responsible for restoring the selection on the underlying <textarea> via
 * setSelectionRange after React re-renders.
 *
 * Selection semantics (matching DOM textarea):
 * - { start: i, end: i }: caret at position i, no selection
 * - { start: i, end: j }: text from i to j (j > i) is selected
 */

export type Selection = { start: number; end: number };
export type ToolbarResult = { value: string; selection: Selection };

const BOLD_PLACEHOLDER = '太字';
const LINK_PLACEHOLDER = 'リンク';
const CODE_PLACEHOLDER = 'code';

export function insertBold(value: string, sel: Selection): ToolbarResult {
  const before = value.slice(0, sel.start);
  const selected = value.slice(sel.start, sel.end);
  const after = value.slice(sel.end);

  if (selected.length === 0) {
    const inserted = `**${BOLD_PLACEHOLDER}**`;
    const newValue = before + inserted + after;
    // Cursor on the placeholder text so user can type to replace
    return {
      value: newValue,
      selection: { start: sel.start + 2, end: sel.start + 2 + BOLD_PLACEHOLDER.length },
    };
  }

  const newValue = before + '**' + selected + '**' + after;
  return {
    value: newValue,
    selection: { start: sel.start, end: sel.end + 4 },
  };
}

export function insertHeading(value: string, sel: Selection): ToolbarResult {
  return toggleLinePrefix(value, sel, '## ');
}

export function insertBulletList(value: string, sel: Selection): ToolbarResult {
  return toggleLinePrefix(value, sel, '- ');
}

export function insertNumberedList(value: string, sel: Selection): ToolbarResult {
  // Numbered lists are line-based but renumbered; can't reuse toggleLinePrefix directly
  const { lineStart, lineEnd, lines, prefixLen } = sliceLines(value, sel);

  // If single line and already starts with "N. ", strip it (toggle off)
  if (lines.length === 1) {
    const m = lines[0].match(/^(\d+\. )/);
    if (m) {
      const newLine = lines[0].slice(m[1].length);
      const newValue = value.slice(0, lineStart) + newLine + value.slice(lineEnd);
      const adjustedStart = Math.max(lineStart, sel.start - m[1].length);
      const adjustedEnd = Math.max(lineStart, sel.end - m[1].length);
      return { value: newValue, selection: { start: adjustedStart, end: adjustedEnd } };
    }
  }

  const numberedLines = lines.map((line, i) => `${i + 1}. ${line}`);
  const replaced = numberedLines.join('\n');
  const newValue = value.slice(0, lineStart) + replaced + value.slice(lineEnd);
  const addedLen = replaced.length - (lineEnd - lineStart);
  return {
    value: newValue,
    selection: {
      start: sel.start === lineStart ? lineStart : sel.start + 3, // first line gets "1. "
      end: sel.end + addedLen - (sel.start === lineStart ? 0 : 0),
    },
  };

  // (Note: prefixLen is unused here; sliceLines exposes it for the bullet path)
  void prefixLen;
}

export function insertLink(
  value: string,
  sel: Selection,
  url: string,
): ToolbarResult | null {
  if (!url) return null;
  const before = value.slice(0, sel.start);
  const selected = value.slice(sel.start, sel.end);
  const after = value.slice(sel.end);

  if (selected.length === 0) {
    const text = LINK_PLACEHOLDER;
    const newValue = `${before}[${text}](${url})${after}`;
    // cursor on placeholder text so user can replace
    return {
      value: newValue,
      selection: { start: sel.start + 1, end: sel.start + 1 + text.length },
    };
  }

  const newValue = `${before}[${selected}](${url})${after}`;
  return {
    value: newValue,
    selection: { start: sel.start, end: sel.end + 4 + url.length }, // [ ] ( )
  };
}

export function insertCode(value: string, sel: Selection): ToolbarResult {
  const before = value.slice(0, sel.start);
  const selected = value.slice(sel.start, sel.end);
  const after = value.slice(sel.end);

  if (selected.length === 0) {
    const text = CODE_PLACEHOLDER;
    const newValue = `${before}\`${text}\`${after}`;
    return {
      value: newValue,
      selection: { start: sel.start + 1, end: sel.start + 1 + text.length },
    };
  }

  if (selected.includes('\n')) {
    // Multi-line → fenced code block
    const newValue = `${before}\`\`\`\n${selected}\n\`\`\`${after}`;
    return {
      value: newValue,
      selection: { start: sel.start, end: sel.end + 8 }, // ```\n + \n```
    };
  }

  // Single-line → inline code
  const newValue = `${before}\`${selected}\`${after}`;
  return {
    value: newValue,
    selection: { start: sel.start, end: sel.end + 2 },
  };
}

/**
 * On Enter inside a list item, continue the list automatically.
 *
 * Triggered from a keydown handler with a single caret (no selection).
 * - Bullet list (`- foo` / `* foo`, optionally indented): continue with the same marker on the next line
 * - Numbered list (`1. foo`): continue with the next integer
 * - Empty list item (just the prefix, no content): exit the list (strip the prefix)
 * - Non-list lines: return null so the caller falls through to default Enter behavior
 */
export function continueList(value: string, sel: Selection): ToolbarResult | null {
  if (sel.start !== sel.end) return null; // only on caret, not range selection

  const before = value.slice(0, sel.start);
  const after = value.slice(sel.end);
  const lineStart = (() => {
    const i = before.lastIndexOf('\n');
    return i === -1 ? 0 : i + 1;
  })();
  const currentLineBeforeCaret = before.slice(lineStart);

  const bulletMatch = currentLineBeforeCaret.match(/^(\s*)([-*])\s/);
  if (bulletMatch) {
    const indent = bulletMatch[1];
    const marker = bulletMatch[2];
    const prefix = `${indent}${marker} `;

    if (currentLineBeforeCaret === prefix) {
      // Empty list item → exit list by stripping prefix
      const newValue = value.slice(0, lineStart) + after;
      return {
        value: newValue,
        selection: { start: lineStart, end: lineStart },
      };
    }

    const insert = '\n' + prefix;
    const newValue = before + insert + after;
    return {
      value: newValue,
      selection: { start: sel.start + insert.length, end: sel.start + insert.length },
    };
  }

  const numMatch = currentLineBeforeCaret.match(/^(\s*)(\d+)\.\s/);
  if (numMatch) {
    const indent = numMatch[1];
    const num = parseInt(numMatch[2], 10);
    const prefix = `${indent}${num}. `;

    if (currentLineBeforeCaret === prefix) {
      const newValue = value.slice(0, lineStart) + after;
      return {
        value: newValue,
        selection: { start: lineStart, end: lineStart },
      };
    }

    const nextPrefix = `${indent}${num + 1}. `;
    const insert = '\n' + nextPrefix;
    const newValue = before + insert + after;
    return {
      value: newValue,
      selection: { start: sel.start + insert.length, end: sel.start + insert.length },
    };
  }

  return null;
}

/**
 * Apply a per-line prefix (like "- " or "## ") to all lines in the selection.
 * If applied to a single line that already has the prefix, toggle it off.
 */
function toggleLinePrefix(value: string, sel: Selection, prefix: string): ToolbarResult {
  const { lineStart, lineEnd, lines } = sliceLines(value, sel);

  // Toggle off only when single line and that line starts with prefix
  if (lines.length === 1 && lines[0].startsWith(prefix)) {
    const newLine = lines[0].slice(prefix.length);
    const newValue = value.slice(0, lineStart) + newLine + value.slice(lineEnd);
    const adjustedStart = Math.max(lineStart, sel.start - prefix.length);
    const adjustedEnd = Math.max(lineStart, sel.end - prefix.length);
    return { value: newValue, selection: { start: adjustedStart, end: adjustedEnd } };
  }

  // Toggle on: prefix lines that don't already have it
  const prefixed = lines.map((line) => (line.startsWith(prefix) ? line : prefix + line));
  const replaced = prefixed.join('\n');
  const newValue = value.slice(0, lineStart) + replaced + value.slice(lineEnd);

  const totalAdded = lines.reduce(
    (acc, line) => acc + (line.startsWith(prefix) ? 0 : prefix.length),
    0,
  );
  const firstLineAdded = lines[0].startsWith(prefix) ? 0 : prefix.length;
  const isCaret = sel.start === sel.end;

  if (isCaret) {
    // Caret moves forward by the prefix added on its line
    return {
      value: newValue,
      selection: { start: sel.start + firstLineAdded, end: sel.end + firstLineAdded },
    };
  }

  // Range selection: anchor start at lineStart if it was already there (typical
  // VS Code behavior of letting the prefix become part of the selection),
  // otherwise shift forward by firstLineAdded
  const newStart = sel.start === lineStart ? lineStart : sel.start + firstLineAdded;
  return {
    value: newValue,
    selection: { start: newStart, end: sel.end + totalAdded },
  };
}

/**
 * Slice the value by the line-aligned bounds of the selection.
 * Returns the start/end offsets and the list of selected lines.
 */
function sliceLines(value: string, sel: Selection): {
  lineStart: number;
  lineEnd: number;
  lines: string[];
  prefixLen: number;
} {
  const lineStart = (() => {
    const i = value.lastIndexOf('\n', sel.start - 1);
    return i === -1 ? 0 : i + 1;
  })();
  const lineEnd = (() => {
    const i = value.indexOf('\n', sel.end);
    return i === -1 ? value.length : i;
  })();
  const lines = value.slice(lineStart, lineEnd).split('\n');
  return { lineStart, lineEnd, lines, prefixLen: 0 };
}
