'use client';

import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer } from './markdown-renderer';
import { cn } from '@/lib/utils';

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  rows?: number;
};

const PLACEHOLDER = `Markdown で書けます。例:
# 見出し
**太字** *斜体*
- 箇条書き
[リンク](https://example.com)
\`\`\`
コードブロック
\`\`\``;

export function MarkdownEditor({ value, onChange, placeholder, rows = 8 }: Props) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');

  return (
    <div className="border border-gray-200 rounded-md bg-white overflow-hidden">
      <div className="flex border-b border-gray-200 bg-gray-50">
        <button
          type="button"
          onClick={() => setTab('edit')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors',
            tab === 'edit'
              ? 'bg-white text-gray-900 border-b-2 border-blue-600 -mb-px'
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
              ? 'bg-white text-gray-900 border-b-2 border-blue-600 -mb-px'
              : 'text-gray-500 hover:text-gray-700',
          )}
        >
          プレビュー
        </button>
      </div>
      {tab === 'edit' ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? PLACEHOLDER}
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
    </div>
  );
}
