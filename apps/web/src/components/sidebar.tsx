'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  Handshake,
  Inbox,
  LayoutDashboard,
  Lightbulb,
  MessageSquare,
  Rocket,
  Settings,
  Target,
  TerminalSquare,
  Users,
} from 'lucide-react';

import { cn } from '../lib/utils.js';

const DASHBOARD_NAV_ITEMS = [
  { href: '/dashboard', label: 'Pipeline', icon: LayoutDashboard },
  { href: '/dashboard/discover', label: 'Discover', icon: Rocket },
  { href: '/dashboard/leads', label: 'Leads', icon: Users },
  { href: '/dashboard/messages', label: 'Messages', icon: MessageSquare },
  { href: '/dashboard/inbox', label: 'Inbox', icon: Inbox },
  { href: '/dashboard/icps', label: 'ICP Profiles', icon: Target },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/analytics/deals', label: 'Deals', icon: Handshake },
  { href: '/dashboard/recommendations', label: 'Recommendations', icon: Lightbulb },
  { href: '/dashboard/jobs', label: 'Jobs', icon: Activity },
] as const;

const DEV_CONSOLE_NAV_ITEMS = [
  { href: '/discovery', label: 'Controls & Settings', icon: Settings },
  { href: '/discovery/rules', label: 'ICP & Rules', icon: TerminalSquare },
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
        'hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex',
        'sticky top-0 h-screen',
        'transition-[width] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]',
        collapsed ? 'w-[68px]' : 'w-[260px]',
      )}
    >
      {/* Brand + collapse toggle */}
      <div className="flex h-16 items-center border-b border-sidebar-border">
        <div
          className={cn(
            'flex items-center gap-3 overflow-hidden',
            collapsed ? 'px-0 justify-center w-full' : 'px-5 flex-1 min-w-0',
          )}
        >
          <Image
            src="/zbooni-icon.png"
            alt="Zbooni"
            width={32}
            height={32}
            className="shrink-0 rounded-lg"
            aria-hidden="true"
          />
          <div
            className={cn(
              'flex flex-col overflow-hidden transition-[opacity,max-width] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]',
              collapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100',
            )}
          >
            <span className="truncate text-[15px] font-bold leading-tight tracking-tight text-sidebar-foreground">
              Zbooni
            </span>
            <span className="truncate text-[11px] font-medium leading-tight text-muted-foreground">
              Sales OS
            </span>
          </div>
        </div>
        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              'mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
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
      <nav className={cn('flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden', collapsed ? 'p-2' : 'p-3')}>
        {/* Dashboard section label */}
        <p
          className={cn(
            'mb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-[opacity,max-height] duration-250',
            collapsed ? 'max-h-0 opacity-0 overflow-hidden mb-0 pt-0' : 'max-h-8 opacity-100 px-3',
          )}
        >
          Dashboard
        </p>

        {DASHBOARD_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                'group flex items-center rounded-xl text-[13px] font-medium transition-all duration-150',
                collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5',
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
                  collapsed ? 'max-w-0 opacity-0 overflow-hidden' : 'max-w-[180px] opacity-100',
                )}
              >
                {label}
              </span>
              {isActive && !collapsed ? (
                <div className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-zbooni-green" aria-hidden="true" />
              ) : null}
            </Link>
          );
        })}

        {/* Discovery section label */}
        <p
          className={cn(
            'mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-[opacity,max-height] duration-250',
            collapsed ? 'max-h-0 opacity-0 overflow-hidden mb-0 mt-1' : 'max-h-8 opacity-100 px-3',
          )}
        >
          Dev Console
        </p>

        {DEV_CONSOLE_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === '/discovery'
              ? pathname === '/discovery'
              : href.startsWith('/discovery#')
                ? pathname === '/discovery'
              : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                'group flex items-center rounded-xl text-[13px] font-medium transition-all duration-150',
                collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
              )}
            >
              <Icon
                className={cn(
                  'h-[18px] w-[18px] shrink-0 transition-colors',
                  isActive ? 'text-zbooni-teal' : 'text-muted-foreground group-hover:text-sidebar-foreground',
                )}
              />
              <span
                className={cn(
                  'truncate transition-[opacity,max-width] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]',
                  collapsed ? 'max-w-0 opacity-0 overflow-hidden' : 'max-w-[180px] opacity-100',
                )}
              >
                {label}
              </span>
              {isActive && !collapsed ? (
                <div className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-zbooni-teal" aria-hidden="true" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Footer — intentionally empty, no more workflow text */}
    </aside>
  );
}
