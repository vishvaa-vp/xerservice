import { redirect } from 'next/navigation';

/**
 * Legacy administrator entry point retained for existing bookmarks.
 * The live, API-backed dashboard is the canonical admin experience.
 */
export default function LegacyAdminDashboardRedirect() {
    redirect('/admin/dashboard');
}
