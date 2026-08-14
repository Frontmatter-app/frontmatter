import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SidebarSectionProps {
  label: string;
  /** Hover-revealed controls, e.g. new file and new folder. */
  actions?: React.ReactNode;
  /** Trailing element that stays visible, e.g. a count. */
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  bodyProps?: React.HTMLAttributes<HTMLDivElement>;
  className?: string;
}

/**
 * A collapsible sidebar section.
 *
 * The explorer and the outline used to be two states of one slot, swapped by a
 * tab strip — so reading the outline meant losing sight of the files, and the
 * outline tab was disabled whenever no document was open. As sections they are
 * both simply present, and each can be collapsed when it is not wanted.
 */
export function SidebarSection({
  label, actions, badge, defaultOpen = true, children, bodyProps, className,
}: SidebarSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="group flex items-center justify-between px-2 mb-1">
        <button
          onClick={() => setOpen(value => !value)}
          aria-expanded={open}
          className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer"
        >
          {open
            ? <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
            : <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
          }
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 truncate">
            {label}
          </span>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          {actions && (
            <div className="flex items-center gap-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition">
              {actions}
            </div>
          )}
          {badge}
        </div>
      </div>

      {open && <div {...bodyProps}>{children}</div>}
    </div>
  );
}
