import { redirect } from 'next/navigation';

export default async function AdminLoginPage({
    searchParams,
}: {
    searchParams?: Promise<{ redirect?: string }>;
}) {
    // Next.js 15: searchParams is a Promise; searchParams?.redirect is resolved below
    const resolvedParams = await searchParams;
    const target = resolvedParams?.redirect
        ? `/xad/login?redirect=${encodeURIComponent(resolvedParams.redirect)}`
        : '/xad/login';
    redirect(target);
}
