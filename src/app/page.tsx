import { redirect } from 'next/navigation';
import { currentUserId } from './_lib/session';

export default async function Home() {
  redirect((await currentUserId()) ? '/console' : '/login');
}
