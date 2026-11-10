import { redirect } from 'next/navigation';
import { currentUserId } from '@/server/session';

export default async function Home() {
  redirect((await currentUserId()) ? '/console' : '/login');
}
