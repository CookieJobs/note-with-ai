import type { MouseEventHandler, ReactNode } from 'react';

export type RelationshipCueProps = {
  sourceLabel: string;
  targetLabel?: string;
  kind?: string;
  explanation?: string;
  href?: string;
  linkClassName?: string;
  onLinkClick?: MouseEventHandler<HTMLAnchorElement>;
};

export function RelationshipCue({
  sourceLabel,
  targetLabel,
  kind,
  explanation,
  href,
  linkClassName,
  onLinkClick,
}: RelationshipCueProps) {
  const target: ReactNode = targetLabel ? (
    href ? <a href={href} className={linkClassName} onClick={onLinkClick}>{targetLabel}</a> : <span>{targetLabel}</span>
  ) : null;

  return (
    <div className="grid gap-1 text-sm [color:var(--color-text-secondary)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium [color:var(--color-text-primary)]">{sourceLabel}</span>
        {target ? (
          <span className="flex items-center gap-1" aria-hidden="true" data-relationship-line>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" data-relationship-node />
            <span className="h-px w-5 bg-current" />
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" data-relationship-node />
          </span>
        ) : null}
        {target}
        {kind ? (
          <span className="rounded-[var(--radius-pill)] bg-[var(--color-action-secondary)] px-2 py-0.5 text-xs font-medium [color:var(--color-text-secondary)]">
            {kind}
          </span>
        ) : null}
      </div>
      {explanation ? <p className="m-0 leading-5">{explanation}</p> : null}
    </div>
  );
}
