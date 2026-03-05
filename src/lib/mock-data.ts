// ─── Mock Data & Types ───────────────────────────────────────────────────────

export interface Shop {
    id: string;
    name: string;
    address: string;
    distance: number; // km
    rating: number;
    reviewCount: number;
    isOpen: boolean;
    closingSoon: boolean;
    openTime: string;
    closeTime: string;
    description: string;
    services: string[];
    pricePerPage: number; // base price
    imageInitials: string;
    reviews: Review[];
}

export interface Review {
    id: string;
    author: string;
    rating: number;
    comment: string;
    date: string;
}

export interface Order {
    id: string;
    shopId: string;
    shopName: string;
    fileName: string;
    files?: { name: string, pages: number, color: boolean }[];
    pages: number;
    color: boolean;
    sides: 'single' | 'double' | 'double_long' | 'double_short';
    orientation: 'portrait' | 'landscape';
    copies: number;
    method: 'instant' | 'scheduled';
    scheduledTime?: string;
    paymentMethod: 'upi' | 'card' | 'wallet';
    totalAmount: number;
    status: 'pending' | 'printing' | 'ready' | 'completed';
    createdAt: string;
    customerMobile: string;
}

export interface VendorOrder {
    orderId: string;
    mobileLastFour: string;
    pages: number;
    color: boolean;
    status: 'queue' | 'printing' | 'completed';
    amount: number;
    time: string;
}

// ─── Pricing Logic ────────────────────────────────────────────────────────────

export function calculatePrice(pages: number, color: boolean, sides: 'single' | 'double' | 'double_long' | 'double_short', copies: number): number {
    let basePrice: number;
    if (pages <= 10) basePrice = 2.0;
    else if (pages <= 50) basePrice = 1.75;
    else if (pages <= 100) basePrice = 1.5;
    else basePrice = 1.25;

    const colorMultiplier = color ? 3.5 : 1;
    const effectivePages = (sides === 'double' || sides === 'double_long' || sides === 'double_short') ? Math.ceil(pages / 2) : pages;
    return Math.round(basePrice * effectivePages * colorMultiplier * copies * 100) / 100;
}

// ─── Mock Shops ───────────────────────────────────────────────────────────────

export const mockShops: Shop[] = [
    {
        id: '1',
        name: 'PrintHub Express',
        address: '12, RS Puram, Coimbatore - 641002',
        distance: 0.4,
        rating: 4.8,
        reviewCount: 124,
        isOpen: true,
        closingSoon: false,
        openTime: '9:00 AM',
        closeTime: '9:00 PM',
        description: 'Coimbatore\'s fastest print shop. We handle everything from single pages to large volumes with precision and speed.',
        services: ['Black & White Printing', 'Color Printing', 'Binding', 'Lamination', 'Scanning', 'Photocopying'],
        pricePerPage: 2.0,
        imageInitials: 'PH',
        reviews: [
            { id: 'r1', author: 'Arjun M.', rating: 5, comment: 'Super fast! Got my 50-page document printed in 10 minutes.', date: '2026-02-28' },
            { id: 'r2', author: 'Priya S.', rating: 5, comment: 'Great quality and very affordable.', date: '2026-02-20' },
            { id: 'r3', author: 'Rohan K.', rating: 4, comment: 'Good service, slightly busy on weekends.', date: '2026-02-15' },
        ]
    },
    {
        id: '2',
        name: 'QuickPrint Studio',
        address: '45, Gandhipuram, Coimbatore - 641012',
        distance: 1.2,
        rating: 4.6,
        reviewCount: 89,
        isOpen: true,
        closingSoon: true,
        openTime: '8:30 AM',
        closeTime: '8:30 PM',
        description: 'Professional printing services with same-day delivery option. Specializing in high-quality color prints.',
        services: ['Color Printing', 'Black & White Printing', 'Poster Printing', 'Business Cards', 'Spiral Binding'],
        pricePerPage: 1.75,
        imageInitials: 'QP',
        reviews: [
            { id: 'r4', author: 'Sneha R.', rating: 5, comment: 'Best color printing in the area. Very crisp output.', date: '2026-02-25' },
            { id: 'r5', author: 'Dev P.', rating: 4, comment: 'Prices are great. Will come back.', date: '2026-02-10' },
        ]
    },
    {
        id: '3',
        name: 'DocXpress',
        address: '78, Peelamedu, Coimbatore - 641004',
        distance: 2.1,
        rating: 4.5,
        reviewCount: 203,
        isOpen: true,
        closingSoon: false,
        openTime: '7:00 AM',
        closeTime: '10:00 PM',
        description: 'Extended hours print shop. Open early and late to serve your needs any time of day.',
        services: ['Black & White Printing', 'Color Printing', 'Scanning', 'Photocopying', 'Document Binding', 'Lamination', 'Notarization Support'],
        pricePerPage: 1.5,
        imageInitials: 'DX',
        reviews: [
            { id: 'r6', author: 'Kavya L.', rating: 5, comment: 'Amazing, they were open at 7 AM when I needed urgent prints!', date: '2026-02-22' },
            { id: 'r7', author: 'Rahul T.', rating: 4, comment: 'Good all-rounder shop. Gets busy.', date: '2026-02-14' },
            { id: 'r8', author: 'Meera V.', rating: 5, comment: 'Cheapest rates and good quality!', date: '2026-02-01' },
        ]
    },
    {
        id: '4',
        name: 'StationeryWorld Print',
        address: '22, Saibaba Colony, Coimbatore - 641011',
        distance: 3.5,
        rating: 4.3,
        reviewCount: 56,
        isOpen: false,
        closingSoon: false,
        openTime: '10:00 AM',
        closeTime: '7:00 PM',
        description: 'Full-service stationary and print shop. Wide range of paper sizes and types available.',
        services: ['Black & White Printing', 'Color Printing', 'Stationery', 'Binding', 'Lamination'],
        pricePerPage: 2.0,
        imageInitials: 'SW',
        reviews: [
            { id: 'r9', author: 'Ananya B.', rating: 4, comment: 'Good quality, but closed on Sundays.', date: '2026-01-30' },
        ]
    },
    {
        id: '5',
        name: 'PaperWorks',
        address: '9, Singanallur Main Road, Coimbatore - 641005',
        distance: 4.8,
        rating: 4.7,
        reviewCount: 167,
        isOpen: true,
        closingSoon: false,
        openTime: '9:00 AM',
        closeTime: '9:30 PM',
        description: 'High-volume print shop catering to businesses and students. Bulk discounts available.',
        services: ['Black & White Printing', 'Color Printing', 'Bulk Orders', 'Binding', 'A3 Printing', 'Banner Printing'],
        pricePerPage: 1.5,
        imageInitials: 'PW',
        reviews: [
            { id: 'r10', author: 'Vikram S.', rating: 5, comment: 'Excellent for bulk orders! Great price for 200+ pages.', date: '2026-02-26' },
            { id: 'r11', author: 'Nisha J.', rating: 4, comment: 'Fast and professional.', date: '2026-02-18' },
        ]
    },
];

// ─── Mock Orders (Customer) ───────────────────────────────────────────────────

export const mockOrders: Order[] = [
    {
        id: '1001',
        shopId: '1',
        shopName: 'PrintHub Express',
        fileName: 'Project_Report_Q4.pdf',
        pages: 45,
        color: false,
        sides: 'double',
        orientation: 'portrait',
        copies: 1,
        method: 'instant',
        paymentMethod: 'upi',
        totalAmount: 39.38,
        status: 'completed',
        createdAt: '2026-02-28T14:30:00',
        customerMobile: '9876543210',
    },
    {
        id: '1002',
        shopId: '2',
        shopName: 'QuickPrint Studio',
        fileName: 'Presentation_Final.pptx',
        pages: 20,
        color: true,
        sides: 'single',
        orientation: 'landscape',
        copies: 2,
        method: 'instant',
        paymentMethod: 'wallet',
        totalAmount: 245.0,
        status: 'completed',
        createdAt: '2026-03-01T11:00:00',
        customerMobile: '9876543210',
    },
    {
        id: '1003',
        shopId: '1',
        shopName: 'PrintHub Express',
        fileName: 'Resume_2026.pdf',
        pages: 2,
        color: false,
        sides: 'single',
        orientation: 'portrait',
        copies: 5,
        method: 'instant',
        paymentMethod: 'card',
        totalAmount: 20.0,
        status: 'ready',
        createdAt: '2026-03-04T09:15:00',
        customerMobile: '9876543210',
    },
];

// ─── Mock Vendor Orders ────────────────────────────────────────────────────────

export const mockVendorOrders: VendorOrder[] = [
    { orderId: '1003', mobileLastFour: '3210', pages: 12, color: false, status: 'queue', amount: 24, time: '10:15 AM' },
    { orderId: '1004', mobileLastFour: '7732', pages: 54, color: true, status: 'queue', amount: 283.5, time: '10:22 AM' },
    { orderId: '1005', mobileLastFour: '5519', pages: 8, color: false, status: 'printing', amount: 16, time: '10:28 AM' },
];

export const mockCompletedOrders: VendorOrder[] = [
    { orderId: '1001', mobileLastFour: '3210', pages: 45, color: false, status: 'completed', amount: 78.75, time: '9:00 AM' },
    { orderId: '1002', mobileLastFour: '4481', pages: 20, color: true, status: 'completed', amount: 140, time: '9:30 AM' },
    { orderId: '1006', mobileLastFour: '9902', pages: 6, color: false, status: 'completed', amount: 12, time: '9:55 AM' },
];

// ─── Vendor Revenue Data ───────────────────────────────────────────────────────

export const vendorRevenueData = {
    labels: ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'],
    datasets: [
        {
            label: 'Revenue (₹)',
            data: [38000, 52000, 47000, 61000, 58000, 72000, 31000],
            backgroundColor: 'var(--fg)',
            borderRadius: 6,
            borderSkipped: false,
        }
    ]
};

// ─── Badge System ─────────────────────────────────────────────────────────────

export const badges = [
    { id: 'contributor', label: 'Contributor', description: 'Made your first suggestion', icon: 'lightbulb', color: '#fb923c' },
    { id: 'active', label: 'Active Member', description: 'Posted 10+ times', icon: 'bolt', color: '#fb923c' },
    { id: 'star', label: 'Star Member', description: 'Received 50+ upvotes', icon: 'star', color: '#3b82f6' },
    { id: 'pro', label: 'Pro Member', description: 'Community leader with 100+ contributions', icon: 'trophy', color: '#3b82f6' },
];

// ─── Admin Data ───────────────────────────────────────────────────────────────

export interface AdminShopRequest {
    id: string;
    name: string;
    ownerName: string;
    mobile: string;
    address: string;
    requestedAt: string;
    status: 'pending' | 'approved' | 'rejected';
    commission: number;
}

export const mockAdminShops: AdminShopRequest[] = [
    { id: 'a1', name: 'BluePrint Co.', ownerName: 'Ramesh G.', mobile: '9988776655', address: 'Singanallur, Coimbatore', requestedAt: '2026-03-01', status: 'pending', commission: 8 },
    { id: 'a2', name: 'PrintMasters', ownerName: 'Suresh K.', mobile: '9900112233', address: 'Saibaba Colony, Coimbatore', requestedAt: '2026-02-28', status: 'pending', commission: 8 },
    { id: 'a3', name: 'PrintHub Express', ownerName: 'Anil V.', mobile: '9876543210', address: 'RS Puram, Coimbatore', requestedAt: '2026-01-15', status: 'approved', commission: 10 },
    { id: 'a4', name: 'QuickPrint Studio', ownerName: 'Mohan R.', mobile: '9871234567', address: 'Gandhipuram, Coimbatore', requestedAt: '2026-01-20', status: 'approved', commission: 8 },
    { id: 'a5', name: 'BadPrint Co.', ownerName: 'X Y', mobile: '1234567890', address: 'Unknown', requestedAt: '2026-02-01', status: 'rejected', commission: 0 },
];

export const mockComplaints = [
    { id: 'c1', mobile: '9123456789', description: 'My order was printed incorrectly. Wrong paper size.', date: '2026-03-02' },
    { id: 'c2', mobile: '9876543210', description: 'Payment deducted but order was not sent to shop.', date: '2026-03-03' },
    { id: 'c3', mobile: '9000111222', description: 'Shop marked order as completed but I never received it.', date: '2026-03-04' },
];

// ─── Forum Posts ──────────────────────────────────────────────────────────────

export interface ForumPost {
    id: string;
    author: string;
    authorBadge?: string;
    category: 'feature' | 'problem' | 'general';
    title: string;
    body: string;
    upvotes: number;
    comments: ForumComment[];
    createdAt: string;
}

export interface ForumComment {
    id: string;
    author: string;
    body: string;
    createdAt: string;
}

export const mockForumPosts: ForumPost[] = [
    {
        id: 'f1', author: 'Arjun M.', authorBadge: 'star', category: 'feature',
        title: 'Add WhatsApp notification when order is ready',
        body: 'It would be great to get a WhatsApp message when my print order is ready for pickup. Currently I have to keep checking the app.',
        upvotes: 42, createdAt: '2026-03-01T10:00:00',
        comments: [
            { id: 'fc1', author: 'Priya S.', body: 'Yes! This would be very useful.', createdAt: '2026-03-01T11:00:00' },
            { id: 'fc2', author: 'Dev P.', body: '+1 to this feature request.', createdAt: '2026-03-02T09:00:00' },
        ]
    },
    {
        id: 'f2', author: 'Sneha R.', authorBadge: 'contributor', category: 'problem',
        title: 'Scheduled order file replacement not working',
        body: 'When I try to replace the file for a scheduled order, it shows an error. Please fix this.',
        upvotes: 17, createdAt: '2026-03-02T14:00:00',
        comments: []
    },
    {
        id: 'f3', author: 'Vikram S.', authorBadge: 'pro', category: 'feature',
        title: 'Bulk order discounts should be shown upfront',
        body: 'I only discovered the bulk pricing after I had already placed my order. Show it during the settings step.',
        upvotes: 29, createdAt: '2026-03-03T08:30:00',
        comments: [
            { id: 'fc3', author: 'Kavya L.', body: 'Totally agree! I was confused by the final price.', createdAt: '2026-03-03T10:00:00' },
        ]
    },
];

// ─── Subscription Plans ───────────────────────────────────────────────────────

export const subscriptionPlans = [
    { id: 'starter', name: 'Starter', price: 499, orders: 100, description: 'Perfect for small shops just getting started.' },
    { id: 'growth', name: 'Growth', price: 999, orders: 500, description: 'For growing shops with steady order volume.', popular: true },
    { id: 'pro', name: 'Pro', price: 1999, orders: -1, description: 'Unlimited orders for high-volume print shops.' },
];

export const billingHistory = [
    { plan: 'Growth Plan', month: 'Feb 2026', amount: 999 },
    { plan: 'Growth Plan', month: 'Jan 2026', amount: 999 },
    { plan: 'Growth Plan', month: 'Dec 2025', amount: 999 },
];
