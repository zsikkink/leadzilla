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
  X,
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
  mobile?: boolean | undefined;
  onNavigate?: (() => void) | undefined;
}

export function Sidebar({ collapsed, onToggle, mobile = false, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const isCollapsed = mobile ? false : collapsed;

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar',
        mobile ? 'h-full w-[min(86vw,300px)] shadow-2xl shadow-black/50' : 'sticky top-0 h-screen',
        'transition-[width] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]',
        !mobile && (isCollapsed ? 'w-[68px]' : 'w-[260px]'),
      )}
    >
      {/* Brand + collapse toggle */}
      <div className="flex h-16 items-center border-b border-sidebar-border">
        <div
          role="img"
          aria-label="Leadzilla"
          className={cn(
            'flex items-center gap-3 overflow-hidden',
            isCollapsed ? 'w-full justify-center px-0' : 'min-w-0 flex-1 justify-center px-5',
          )}
        >
          <Image
            src={withAppBasePath('/brand/L-logo.svg')}
            alt=""
            width={48}
            height={48}
            className={cn(
              'h-12 w-12 shrink-0 object-contain',
              !isCollapsed && 'hidden',
            )}
          />
          {!isCollapsed && (
            <Image
              src={withAppBasePath('/brand/leadzilla-wordmark.svg')}
              alt=""
              width={504}
              height={115}
              className="block h-auto w-[168px] shrink-0 object-contain"
            />
          )}
        </div>
        {!isCollapsed && (
          <button
            type="button"
            onClick={mobile ? onNavigate : onToggle}
            autoFocus={mobile}
            className={cn(
              'mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
              'text-muted-foreground/60 transition-colors duration-150',
              'hover:bg-sidebar-accent hover:text-sidebar-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            )}
            aria-label={mobile ? 'Close navigation' : 'Collapse sidebar'}
            title={mobile ? 'Close navigation' : 'Collapse sidebar'}
          >
            {mobile ? <X className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Expand button when collapsed — sits below the brand area */}
      {isCollapsed && (
        <div className="flex justify-center border-b border-sidebar-border py-2">
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
      <nav className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden', isCollapsed ? 'p-2' : 'p-3')}>
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
                {...(onNavigate ? { onClick: onNavigate } : {})}
                title={label}
                className={cn(
                  'group flex items-center rounded-xl text-[13px] font-medium transition-all duration-150',
                  isCollapsed
                    ? 'justify-center px-0 py-2.5'
                    : 'justify-start gap-3 px-3 py-2.5',
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
                    isCollapsed ? 'max-w-0 overflow-hidden opacity-0' : 'max-w-[180px] opacity-100',
                  )}
                >
                  {label}
                </span>
                {isActive && !isCollapsed ? (
                  <div className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-zbooni-green" aria-hidden="true" />
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
