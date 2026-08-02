'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Bot,
  ChevronsLeft,
  ChevronsRight,
  Inbox,
  Rocket,
  Settings,
  Target,
  Users,
} from 'lucide-react';

import { withAppBasePath } from '../lib/app-path.js';
import { cn } from '../lib/utils.js';

const DASHBOARD_NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { href: '/dashboard/discover', label: 'Discover', icon: Rocket },
  { href: '/dashboard/leads', label: 'Leads', icon: Users },
  { href: '/dashboard/prompts', label: 'Prompt Center', icon: Bot },
  { href: '/dashboard/inbox', label: 'Inbox', icon: Inbox },
  { href: '/dashboard/icps', label: 'ICPs', icon: Target },
  { href: '/discovery', label: 'Settings', icon: Settings },
] as const;

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar',
        'sticky top-0 h-screen',
        'transition-[width] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]',
        collapsed ? 'w-[68px]' : 'w-[68px] lg:w-[260px]',
      )}
    >
      {/* Brand + collapse toggle */}
      <div className="flex h-16 items-center border-b border-sidebar-border">
        <div
          className={cn(
            'flex items-center gap-3 overflow-hidden',
            collapsed ? 'w-full justify-center px-0' : 'justify-center px-0 lg:min-w-0 lg:flex-1 lg:px-5',
          )}
        >
          <Image
            src={withAppBasePath('/brand/L-logo.svg')}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 object-contain"
          />
          <div
            className={cn(
              'flex flex-col overflow-hidden transition-[opacity,max-width] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]',
              collapsed ? 'max-w-0 opacity-0' : 'max-w-0 opacity-0 lg:max-w-[160px] lg:opacity-100',
            )}
          >
            <span className="truncate text-[15px] font-bold leading-tight tracking-tight text-sidebar-foreground">
              Leadzilla
            </span>
            <span className="truncate text-[11px] font-medium leading-tight text-muted-foreground">
              Demo workspace
            </span>
          </div>
        </div>
        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              'mr-3 hidden h-7 w-7 shrink-0 items-center justify-center rounded-md lg:flex',
              'text-muted-foreground/60 transition-colors duration-150',
              'hover:bg-sidebar-accent hover:text-sidebar-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            )}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Expand button when collapsed — sits below the brand area */}
      {collapsed && (
        <div className="hidden justify-center border-b border-sidebar-border py-2 lg:flex">
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md',
              'text-muted-foreground/60 transition-colors duration-150',
              'hover:bg-sidebar-accent hover:text-sidebar-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            )}
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden', collapsed ? 'p-2' : 'p-2 lg:p-3')}>
        <div className="flex flex-col gap-1">
          {DASHBOARD_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isDiscoverDetailRoute =
              href === '/dashboard/discover' && pathname.startsWith('/dashboard/jobs');
            const isDashboardRoute =
              href === '/dashboard' && (pathname === '/dashboard' || pathname === '/dashboard/analytics');
            const isActive =
              href === '/dashboard'
                ? isDashboardRoute
                : href === '/discovery'
                  ? pathname === href
                  : isDiscoverDetailRoute || pathname === href || pathname.startsWith(`${href}/`);

            return (
              <Link
                key={href}
                href={href}
                prefetch={false}
                title={label}
                className={cn(
                  'group flex items-center rounded-xl text-[13px] font-medium transition-all duration-150',
                  collapsed
                    ? 'justify-center px-0 py-2.5'
                    : 'justify-center px-0 py-2.5 lg:justify-start lg:gap-3 lg:px-3',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                )}
              >
                <Icon
                  className={cn(
                    'h-[18px] w-[18px] shrink-0 transition-colors',
                    isActive ? 'text-zbooni-green' : 'text-muted-foreground group-hover:text-sidebar-foreground',
                  )}
                />
                <span
                  className={cn(
                    'truncate transition-[opacity,max-width] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]',
                    collapsed ? 'max-w-0 overflow-hidden opacity-0' : 'max-w-0 overflow-hidden opacity-0 lg:max-w-[180px] lg:opacity-100',
                  )}
                >
                  {label}
                </span>
                {isActive && !collapsed ? (
                  <div className="ml-auto hidden h-1.5 w-1.5 shrink-0 rounded-full bg-zbooni-green lg:block" aria-hidden="true" />
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer — intentionally empty, no more workflow text */}
    </aside>
  );
}
