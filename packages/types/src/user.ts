/**
 * Authoritative User Types for XerService
 * Pure domain contracts for user roles and account attributes.
 */

export type UserRole = 'customer' | 'vendor' | 'admin';

export type UserAccountStatus = 'active' | 'suspended' | 'pending';

export interface UserProfileSummary {
    id: string;
    email?: string | null;
    fullName?: string | null;
    phoneNumber?: string | null;
    role: UserRole;
    accountStatus?: UserAccountStatus;
    createdAt?: string;
}
