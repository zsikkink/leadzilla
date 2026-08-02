'use client';

import { ShieldX, Users } from 'lucide-react';
import Link from 'next/link';

import { cn } from '../lib/utils.js';

type LeadsNavItem = 'main' | 'rejected';

const NAV_ITEMS: Array<{
  id: LeadsNavItem;
  href: string;
  label: string;
  shortLabel: string;
  icon: typeof Users;
  activeClassName: string;
}> = [
  {
    id: 'main',
    href: '/dashboard/leads',
    label: 'Main Leads',
    shortLabel: 'Main',
    icon: Users,
    activeClassName: 'text-foreground after:bg-zbooni-teal',
  },
  {
    id: 'rejected',
    href: '/dashboard/leads?tab=rejected',
    label: 'Rejected',
    shortLabel: 'Rejected',
    icon: ShieldX,
    activeClassName: 'text-foreground after:bg-red-400',
  },
];

export function LeadsNav({ active }: { active: LeadsNavItem }) {
  return (
    <div className="grid grid-cols-2 border-b border-border/30 sm:flex sm:items-center sm:gap-0.5">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            className={cn(
              'relative inline-flex min-w-0 items-center justify-center gap-1 px-2 py-2.5 text-xs font-medium transition-colors sm:justify-start sm:gap-1.5 sm:px-4 sm:text-sm',
              isActive
                ? cn('after:absolute after:inset-x-0 after:bottom-0 after:h-0.5', item.activeClassName)
                : 'text-muted-foreground/60 hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="sm:hidden">{item.shortLabel}</span>
            <span className="hidden sm:inline">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
