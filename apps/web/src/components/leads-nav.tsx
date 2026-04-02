'use client';

import { Building2, ShieldX, Users, Wrench } from 'lucide-react';
import Link from 'next/link';

import { cn } from '../lib/utils.js';

type LeadsNavItem = 'main' | 'business-intel' | 'contact-recovery' | 'rejected';

const NAV_ITEMS: Array<{
  id: LeadsNavItem;
  href: string;
  label: string;
  icon: typeof Users;
  activeClassName: string;
}> = [
  {
    id: 'main',
    href: '/dashboard/leads',
    label: 'Main Leads',
    icon: Users,
    activeClassName: 'text-foreground after:bg-zbooni-teal',
  },
  {
    id: 'business-intel',
    href: '/dashboard/leads/businesses',
    label: 'Business Intel',
    icon: Building2,
    activeClassName: 'text-foreground after:bg-blue-400',
  },
  {
    id: 'contact-recovery',
    href: '/dashboard/leads/recovery',
    label: 'Contact Recovery',
    icon: Wrench,
    activeClassName: 'text-foreground after:bg-amber-400',
  },
  {
    id: 'rejected',
    href: '/dashboard/leads?tab=rejected',
    label: 'Rejected',
    icon: ShieldX,
    activeClassName: 'text-foreground after:bg-red-400',
  },
];

export function LeadsNav({ active }: { active: LeadsNavItem }) {
  return (
    <div className="flex items-center gap-0.5 border-b border-border/30">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            className={cn(
              'relative inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? cn('after:absolute after:inset-x-0 after:bottom-0 after:h-0.5', item.activeClassName)
                : 'text-muted-foreground/60 hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
