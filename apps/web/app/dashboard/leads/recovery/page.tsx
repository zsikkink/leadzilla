import { redirect } from 'next/navigation';

export default function ContactRecoveryRedirect() {
  redirect('/dashboard/leads');
}
