import { redirect } from 'next/navigation';

export default function LegacyDiscoveryRunsPage() {
  redirect('/dashboard/discover#discovery-runs');
}
