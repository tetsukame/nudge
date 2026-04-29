'use client';

import { useEffect, useRef } from 'react';
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { nord } from '@milkdown/theme-nord';
import { listener, listenerCtx } from '@milkdown/plugin-listener';

import '@milkdown/theme-nord/style.css';

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
};

function EditorInner({ value, onChange }: Props) {
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, valueRef.current);
        ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
          onChangeRef.current(markdown);
        });
      })
      .config(nord)
      .use(commonmark)
      .use(gfm)
      .use(listener),
  );

  return <Milkdown />;
}

export function MarkdownEditor(props: Props) {
  return (
    <MilkdownProvider>
      <div className="milkdown-wrapper border border-gray-200 rounded-md bg-white min-h-[140px] focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 transition-colors">
        <EditorInner {...props} />
      </div>
    </MilkdownProvider>
  );
}

