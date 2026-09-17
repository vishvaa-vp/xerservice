import { redirect } from 'next/navigation';

export default function PrintSettingsPage() {
    redirect('/order/pricing?edit=1');
}
