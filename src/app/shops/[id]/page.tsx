import { redirect } from 'next/navigation';

export default async function ShopDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    redirect(`/order/upload?shop=${id}`);
}
