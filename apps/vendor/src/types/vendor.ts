export interface VendorJoinRequest {
    id: string;
    fullName: string;
    mobile: string;
    email: string;
    role: string;
    experience: string;
    shopName: string;
    shopAddress: string;
    areaPincode: string;
    shopType: string;
    dailyOrders: string;
    requestedAt: string;
    status: 'pending' | 'approved' | 'rejected';
}

export interface VendorShopData {
    id: string;
    name: string;
    status: string;
    closing_soon: boolean;
    closing_message: string | null;
}
