import { redirect } from 'next/navigation';

type LegacyMessagesRedirectPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LegacyMessagesRedirectPage({
  searchParams,
}: LegacyMessagesRedirectPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const nextSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined) {
          nextSearchParams.append(key, item);
        }
      }
    } else if (value !== undefined) {
      nextSearchParams.set(key, value);
    }
  }

  const queryString = nextSearchParams.toString();
  redirect(`/dashboard/inbox${queryString ? `?${queryString}` : ''}`);
}
