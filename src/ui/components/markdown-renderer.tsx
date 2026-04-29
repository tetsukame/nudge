import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

type Props = {
  body: string;
  className?: string;
};

export function MarkdownRenderer({ body, className }: Props) {
  return (
    <div className={`markdown-body text-sm text-gray-800 ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: ({ node: _node, ...props }) => <h1 className="text-lg font-bold mt-3 mb-2" {...props} />,
          h2: ({ node: _node, ...props }) => <h2 className="text-base font-bold mt-3 mb-1.5" {...props} />,
          h3: ({ node: _node, ...props }) => <h3 className="text-sm font-bold mt-2 mb-1" {...props} />,
          p: ({ node: _node, ...props }) => <p className="mb-2 whitespace-pre-wrap leading-relaxed" {...props} />,
          ul: ({ node: _node, ...props }) => <ul className="list-disc list-inside mb-2 space-y-0.5" {...props} />,
          ol: ({ node: _node, ...props }) => <ol className="list-decimal list-inside mb-2 space-y-0.5" {...props} />,
          li: ({ node: _node, ...props }) => <li className="ml-2" {...props} />,
          a: ({ node: _node, ...props }) => (
            <a
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          code: ({ node: _node, className, children, ...props }) => {
            const inline = !/language-/.test(className ?? '');
            return inline ? (
              <code
                className="bg-gray-100 text-pink-600 px-1 py-0.5 rounded text-xs font-mono"
                {...props}
              >
                {children}
              </code>
            ) : (
              <code className={`block ${className ?? ''}`} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ node: _node, ...props }) => (
            <pre className="bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto text-xs font-mono mb-2" {...props} />
          ),
          blockquote: ({ node: _node, ...props }) => (
            <blockquote className="border-l-4 border-gray-300 pl-3 italic text-gray-600 mb-2" {...props} />
          ),
          table: ({ node: _node, ...props }) => (
            <div className="overflow-x-auto mb-2">
              <table className="min-w-full border border-gray-200 text-xs" {...props} />
            </div>
          ),
          thead: ({ node: _node, ...props }) => <thead className="bg-gray-50" {...props} />,
          th: ({ node: _node, ...props }) => <th className="border border-gray-200 px-2 py-1 text-left font-medium" {...props} />,
          td: ({ node: _node, ...props }) => <td className="border border-gray-200 px-2 py-1" {...props} />,
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
