import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AuthProvider } from '../src/lib/auth-context.js';
import { Toaster } from '../src/components/ui/sonner.js';

import './globals.css';

const siteDescription = 'AI-assisted lead generation and outbound sales platform.';

function resolveMetadataBase(): URL {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL;

  if (!configuredUrl) {
    return new URL('http://localhost:3000');
  }

  return new URL(configuredUrl.startsWith('http') ? configuredUrl : `https://${configuredUrl}`);
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: {
    default: 'Leadzilla',
    template: '%s | Leadzilla',
  },
  description: siteDescription,
  applicationName: 'Leadzilla',
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-48x48.png', sizes: '48x48', type: 'image/png' },
      { url: '/favicon-64x64.png', sizes: '64x64', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: [{ url: '/favicon.ico' }],
    apple: [{ url: '/apple-touch-icon.png', type: 'image/png' }],
    other: [
      { rel: 'icon', url: '/android-chrome-192x192.png', type: 'image/png' },
      { rel: 'icon', url: '/android-chrome-512x512.png', type: 'image/png' },
    ],
  },
  openGraph: {
    title: 'Leadzilla',
    description: siteDescription,
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Leadzilla',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Leadzilla',
    description: siteDescription,
    images: ['/og-image.png'],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="min-h-screen antialiased"
        style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
        suppressHydrationWarning
      >
        <AuthProvider>{children}</AuthProvider>
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
