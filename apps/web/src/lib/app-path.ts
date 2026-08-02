export const APP_BASE_PATH = '/leadzilla';

export function withAppBasePath(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error('App paths must start with "/"');
  }

  if (
    path === APP_BASE_PATH ||
    path.startsWith(`${APP_BASE_PATH}/`) ||
    path.startsWith(`${APP_BASE_PATH}?`) ||
    path.startsWith(`${APP_BASE_PATH}#`)
  ) {
    return path;
  }

  return path === '/' ? APP_BASE_PATH : `${APP_BASE_PATH}${path}`;
}
