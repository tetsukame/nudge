import * as React from 'react';
import { cn } from '@/lib/utils';

export type PageHeaderProps = {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

/**
 * 主要画面のページタイトル領域を統一するコンポーネント。
 * 余白・フォントサイズ・アクション配置を画面間で揃える。
 */
export function PageHeader({
  title,
  description,
  icon,
  action,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex items-start justify-between gap-4',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {icon && (
            <span className="text-primary shrink-0 [&>svg]:h-6 [&>svg]:w-6">
              {icon}
            </span>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
        </div>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
