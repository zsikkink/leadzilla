export type DemoPreviewPageKind =
  | 'discover'
  | 'leads'
  | 'prompts'
  | 'inbox'
  | 'icps'
  | 'settings'
  | 'unavailable';

export function getDemoPreviewPageKind(pathname: string): DemoPreviewPageKind | null {
  if (pathname === '/dashboard' || pathname === '/dashboard/analytics') {
    return null;
  }
  if (pathname === '/dashboard/discover' || pathname.startsWith('/dashboard/jobs')) {
    return 'discover';
  }
  if (pathname === '/dashboard/leads' || pathname.startsWith('/dashboard/leads/')) {
    return null;
  }
  if (pathname === '/dashboard/prompts') {
    return null;
  }
  if (pathname === '/dashboard/inbox' || pathname.startsWith('/dashboard/messages')) {
    return 'inbox';
  }
  if (pathname === '/dashboard/icps' || pathname.startsWith('/dashboard/icps/')) {
    return 'icps';
  }
  if (pathname === '/discovery') {
    return 'settings';
  }
  return 'unavailable';
}
