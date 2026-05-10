'use client';

import { useRef, useState } from 'react';
import { Bold, List, ListOrdered, Link as LinkIcon, Heading2, Code } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer } from './markdown-renderer';
import { cn } from '@/lib/utils';
import {
  insertBold,
  insertHeading,
  insertBulletList,
  insertNumberedList,
  insertLink,
  insertCode,
  continueList,
  type Selection,
  type ToolbarResult,
} from './markdown-editor-toolbar';

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  /** Optional placeholder text. Default は空文字列 (NDG-32: ツールバーと
   *  下部チートシートで記法は提示済みなので長文 placeholder は不要)。 */
  placeholder?: string;
  rows?: number;
};

export function MarkdownEditor({ value, onChange, placeholder, rows = 8 }: Props) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const applyTransform = (
    transform: (val: string, sel: Selection) => ToolbarResult | null,
  ) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const sel: Selection = { start: ta.selectionStart, end: ta.selectionEnd };
    const result = transform(value, sel);
    if (!result) return; // e.g. link with empty URL
    onChange(result.value);
    // Restore selection after React re-renders
    requestAnimationFrame(() => {
      const t = textareaRef.current;
      if (!t) return;
      t.focus();
      t.setSelectionRange(result.selection.start, result.selection.end);
    });
  };

  const handleLink = () => {
    const url = window.prompt('リンク先 URL を入力してください', 'https://');
    if (!url) return;
    applyTransform((val, sel) => insertLink(val, sel, url));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // List continuation on Enter (plain Enter only — Shift/Ctrl/Meta+Enter falls through)
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ta = e.currentTarget;
      const sel: Selection = { start: ta.selectionStart, end: ta.selectionEnd };
      const result = continueList(value, sel);
      if (result) {
        e.preventDefault();
        onChange(result.value);
        requestAnimationFrame(() => {
          const t = textareaRef.current;
          if (!t) return;
          t.setSelectionRange(result.selection.start, result.selection.end);
        });
      }
    }
  };

  const isPreview = tab === 'preview';

  const toolbarButtons: Array<{
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
  }> = [
    {
      label: '太字 (選択 → **太字**)',
      icon: <Bold className="h-4 w-4" />,
      onClick: () => applyTransform(insertBold),
    },
    {
      label: '見出し (## ...)',
      icon: <Heading2 className="h-4 w-4" />,
      onClick: () => applyTransform(insertHeading),
    },
    {
      label: '箇条書き (- ...)',
      icon: <List className="h-4 w-4" />,
      onClick: () => applyTransform(insertBulletList),
    },
    {
      label: '番号付きリスト (1. ...)',
      icon: <ListOrdered className="h-4 w-4" />,
      onClick: () => applyTransform(insertNumberedList),
    },
    {
      label: 'リンク ([文字](URL))',
      icon: <LinkIcon className="h-4 w-4" />,
      onClick: handleLink,
    },
    {
      label: 'コード (`code` または ```ブロック```)',
      icon: <Code className="h-4 w-4" />,
      onClick: () => applyTransform(insertCode),
    },
  ];

  return (
    <div className="border border-gray-200 rounded-md bg-white overflow-hidden">
      <div className="flex border-b border-gray-200 bg-gray-50">
        <button
          type="button"
          onClick={() => setTab('edit')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors',
            tab === 'edit'
              ? 'bg-white text-gray-900 border-b-2 border-primary -mb-px'
              : 'text-gray-500 hover:text-gray-700',
          )}
        >
          編集
        </button>
        <button
          type="button"
          onClick={() => setTab('preview')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors',
            tab === 'preview'
              ? 'bg-white text-gray-900 border-b-2 border-primary -mb-px'
              : 'text-gray-500 hover:text-gray-700',
          )}
        >
          プレビュー
        </button>
        <div className="ml-auto flex items-center gap-0.5 px-2 py-1">
          {toolbarButtons.map((btn) => (
            <button
              key={btn.label}
              type="button"
              title={btn.label}
              aria-label={btn.label}
              disabled={isPreview}
              onClick={btn.onClick}
              className={cn(
                'inline-flex items-center justify-center h-8 w-8 rounded transition-colors',
                isPreview
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900',
              )}
            >
              {btn.icon}
            </button>
          ))}
        </div>
      </div>
      {tab === 'edit' ? (
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          className="border-0 rounded-none font-mono text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      ) : (
        <div className="px-4 py-3 min-h-[200px]">
          {value.trim() ? (
            <MarkdownRenderer body={value} />
          ) : (
            <p className="text-gray-400 text-sm">プレビューする内容がありません。</p>
          )}
        </div>
      )}
      <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-600 leading-relaxed">
        <span className="font-medium text-gray-700">Markdown 記法:</span>{' '}
        <code className="font-mono bg-white px-1 rounded border border-gray-200">#</code> 見出し /{' '}
        <code className="font-mono bg-white px-1 rounded border border-gray-200">- </code>箇条書き /{' '}
        <code className="font-mono bg-white px-1 rounded border border-gray-200">1. </code>番号付き /{' '}
        <code className="font-mono bg-white px-1 rounded border border-gray-200">**太字**</code> /{' '}
        <code className="font-mono bg-white px-1 rounded border border-gray-200">*斜体*</code> /{' '}
        <code className="font-mono bg-white px-1 rounded border border-gray-200">[文字](URL)</code>リンク（裸 URL も自動リンク化） /{' '}
        <code className="font-mono bg-white px-1 rounded border border-gray-200">`code`</code> /{' '}
        <code className="font-mono bg-white px-1 rounded border border-gray-200">```</code> コードブロック /{' '}
        <code className="font-mono bg-white px-1 rounded border border-gray-200">| 列 |</code> 表
      </div>
    </div>
  );
}
