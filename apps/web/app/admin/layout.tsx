/**
 * FRIGAT — Admin shell
 *
 * Server component. It re-verifies the session cookie rather than trusting that
 * middleware ran: middleware is matcher-driven configuration, and a matcher
 * mistake must not silently expose the admin tree. Verifying in both places
 * means the guard survives a routing refactor.
 *
 * Deliberately does NOT mount GameSocketProvider — admin staff should not be
 * opening a player game socket, and the two token stores stay separate.
 */

import type { ReactNode } from 'react';
import { cookies } from 'next/headers';

import { AdminGate, type GateUser } from '@/app/admin/AdminGate';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';

import { SESSION_COOKIE, verifySession } from '@/lib/adminAuth';

import '@/app/admin/admin.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'FRIGAT — Admin',
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await verifySession(cookies().get(SESSION_COOKIE)?.value);

  const serverUser: GateUser | null =
    session.status === 'valid' || session.status === 'forbidden'
      ? { id: session.claims.userId, role: session.claims.role }
      : null;

  return (
    <AdminGate serverUser={serverUser}>
      <div className="admin">
        <AdminSidebar adminId={serverUser?.id} />
        <div className="admin__body">
          <AdminHeader adminId={serverUser?.id} />
          <main className="admin__main">{children}</main>
        </div>
      </div>
    </AdminGate>
  );
}
