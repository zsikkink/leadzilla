'use client';

import type { ReactNode } from 'react';

import { AppShell } from '../../src/components/app-shell.js';

import './discovery.css';

export default function DiscoveryLayout({ children }: { children: ReactNode }) {

  return (
    <AppShell>
      <section className="discovery-content">{children}</section>
    </AppShell>
  );
}
