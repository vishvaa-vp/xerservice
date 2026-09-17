'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import AdminHeaderNav from '@/components/admin/AdminHeaderNav';
import {
    Users,
    UserCheck,
    Store,
    Shield,
    CheckCircle2,
    XCircle,
    Ban,
    Search,
    RefreshCw,
    Plus,
    Edit2,
    RotateCcw,
    Eye,
    X,
    AlertCircle,
    Copy,
    Check,
    LogOut,
    ExternalLink,
    Trash2,
} from 'lucide-react';

interface ShopOption {
    shopId: string;
    shopName: string;
    shopStatus: string;
}

interface UserRecord {
    userId: string;
    name: string | null;
    fullName: string | null;
    email: string | null;
    phone: string | null;
    role: 'customer' | 'vendor' | 'admin';
    assignedShop: {
        id: string;
        name: string;
        status: string;
    } | null;
    shop: {
        shopId: string;
        shopName: string;
        shopStatus: string;
    } | null;
    accountStatus: 'active' | 'disabled';
    isDisabled: boolean;
    orderCount: number;
    lastSignInAt: string | null;
    createdAt: string;
    created: string;
}

interface SummaryMetrics {
    totalUsers: number;
    customers: number;
    vendors: number;
    active: number;
    disabled: number;
}

export default function AdminUsersAndVendorsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // State
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);
    const [adminToken, setAdminToken] = useState<string | null>(null);
    const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);

    const [users, setUsers] = useState<UserRecord[]>([]);
    const [summary, setSummary] = useState<SummaryMetrics>({
        totalUsers: 0,
        customers: 0,
        vendors: 0,
        active: 0,
        disabled: 0,
    });
    const [availableShops, setAvailableShops] = useState<ShopOption[]>([]);

    // Search and Filters
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState<string>(searchParams.get('role') || 'all');
    const [statusFilter, setStatusFilter] = useState<string>('all');

    // Modals
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [isResetOpen, setIsResetOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [isProtectedOpen, setIsProtectedOpen] = useState(false);

    // Selected user for Edit/Detail/Delete
    const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
    const [deleteCandidate, setDeleteCandidate] = useState<UserRecord | null>(null);
    const [protectedDetails, setProtectedDetails] = useState<any | null>(null);
    const [deleteSubmitting, setDeleteSubmitting] = useState(false);
    const [detailUser, setDetailUser] = useState<any | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);

    // Create form state
    const [createRole, setCreateRole] = useState<'customer' | 'vendor'>('customer');
    const [createFullName, setCreateFullName] = useState('');
    const [createEmail, setCreateEmail] = useState('');
    const [createPhone, setCreatePhone] = useState('');
    const [createPassword, setCreatePassword] = useState('');
    // Shop fields for vendor
    const [createShopName, setCreateShopName] = useState('');
    const [createShopAddress, setCreateShopAddress] = useState('');
    const [createShopContactPhone, setCreateShopContactPhone] = useState('');
    const [createOpeningTime, setCreateOpeningTime] = useState('09:00');
    const [createClosingTime, setCreateClosingTime] = useState('18:00');
    const [createSubmitting, setCreateSubmitting] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    // Edit form state
    const [editFullName, setEditFullName] = useState('');
    const [editPhone, setEditPhone] = useState('');
    const [editRole, setEditRole] = useState<'customer' | 'vendor'>('customer');
    const [editShopId, setEditShopId] = useState('');
    const [editSubmitting, setEditSubmitting] = useState(false);
    const [editError, setEditError] = useState<string | null>(null);

    // Reset password state
    const [resetLink, setResetLink] = useState<string | null>(null);
    const [resetEmail, setResetEmail] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Fetch shops for vendor assignment dropdown
    const loadShops = useCallback(async (token: string) => {
        try {
            const res = await fetch('/api/admin/finance/shops', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setAvailableShops(data.shops || []);
            }
        } catch (e) {
            console.error('[AdminUsers] Failed to load shops:', e);
        }
    }, []);

    // Load users list
    const loadData = useCallback(async (token: string) => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (search) params.set('search', search);
            if (roleFilter !== 'all') params.set('role', roleFilter);
            if (statusFilter !== 'all') params.set('status', statusFilter);

            const res = await fetch(`/api/admin/users?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to load user records');
            }

            const data = await res.json();
            setUsers(data.users || []);
            if (data.summary) {
                setSummary(data.summary);
            }
        } catch (err: any) {
            setNotification({ type: 'error', message: err.message });
        } finally {
            setLoading(false);
        }
    }, [search, roleFilter, statusFilter]);

    // Auth verification
    useEffect(() => {
        let mounted = true;

        async function verifyAdmin() {
            try {
                const { data: { session }, error } = await supabase.auth.getSession();
                if (error || !session) {
                    if (mounted) router.replace('/xad/login?redirect=/admin/users');
                    return;
                }

                const token = session.access_token;
                const userId = session.user.id;
                if (mounted) {
                    setAdminToken(token);
                    setCurrentAdminId(userId);
                }

                const { data: profile } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('user_id', userId)
                    .single();

                if (!profile || profile.role !== 'admin') {
                    if (mounted) {
                        setAuthError('Access restricted to administrators.');
                        setLoading(false);
                    }
                    return;
                }

                if (mounted) {
                    void loadShops(token);
                }
            } catch {
                if (mounted) router.replace('/xad/login');
            }
        }

        void verifyAdmin();
        return () => { mounted = false; };
    }, [router, loadShops]);

    // Handle search submission
    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (adminToken) loadData(adminToken);
    };

    // Filter changes
    const handleRoleFilterChange = (r: string) => {
        setRoleFilter(r);
    };

    const handleStatusFilterChange = (s: string) => {
        setStatusFilter(s);
    };

    useEffect(() => {
        if (adminToken) {
            loadData(adminToken);
        }
    }, [roleFilter, statusFilter, adminToken, loadData]);

    // Open Create Modal
    const handleOpenCreate = () => {
        setCreateRole('customer');
        setCreateFullName('');
        setCreateEmail('');
        setCreatePhone('');
        setCreatePassword('');
        setCreateShopName('');
        setCreateShopAddress('');
        setCreateShopContactPhone('');
        setCreateOpeningTime('09:00');
        setCreateClosingTime('18:00');
        setCreateError(null);
        setIsCreateOpen(true);
    };

    // Submit Create User
    const handleCreateSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!adminToken) return;
        setCreateError(null);

        if (!createEmail || !createPassword) {
            setCreateError('Email and password are required.');
            return;
        }

        if (createRole === 'vendor') {
            if (!createShopName.trim()) {
                setCreateError('Shop Name is required for vendor accounts.');
                return;
            }
            if (!createShopAddress.trim()) {
                setCreateError('Shop Address is required for vendor accounts.');
                return;
            }
        }

        setCreateSubmitting(true);
        try {
            const payload: Record<string, any> = {
                email: createEmail.trim(),
                password: createPassword,
                fullName: createFullName.trim() || undefined,
                phone: createPhone.trim() || undefined,
                role: createRole,
            };

            if (createRole === 'vendor') {
                payload.shopName = createShopName.trim();
                payload.shopAddress = createShopAddress.trim();
                payload.shopContactPhone = createShopContactPhone.trim() || undefined;
                payload.openingTime = createOpeningTime;
                payload.closingTime = createClosingTime;
            }

            const res = await fetch('/api/admin/users', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to create user');

            setNotification({
                type: 'success',
                message: createRole === 'vendor'
                    ? `Vendor account and print shop "${data.user?.shop?.name || createShopName}" created successfully.`
                    : `Customer account created successfully (${createEmail}).`,
            });
            setIsCreateOpen(false);
            loadData(adminToken);
        } catch (err: any) {
            setCreateError(err.message);
        } finally {
            setCreateSubmitting(false);
        }
    };

    // Open Delete Modal
    const handleOpenDelete = (user: UserRecord) => {
        setDeleteCandidate(user);
        setIsDeleteOpen(true);
    };

    // Confirm Permanent Deletion
    const handleConfirmDelete = async () => {
        if (!adminToken || !deleteCandidate) return;
        setDeleteSubmitting(true);

        try {
            const res = await fetch(`/api/admin/users/${deleteCandidate.userId}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            });

            const data = await res.json();

            if (res.status === 409 || data.isProtected) {
                // Account cannot be deleted due to audit/historical records
                setIsDeleteOpen(false);
                setProtectedDetails(data.details || {});
                setIsProtectedOpen(true);
                return;
            }

            if (!res.ok) {
                throw new Error(data.error || 'Failed to delete user');
            }

            setIsDeleteOpen(false);
            setNotification({
                type: 'success',
                message: `Account for ${deleteCandidate.email || deleteCandidate.fullName || 'User'} was permanently deleted.`,
            });
            loadData(adminToken);
        } catch (err: any) {
            setNotification({ type: 'error', message: err.message });
        } finally {
            setDeleteSubmitting(false);
        }
    };

    // Disable from Protected Modal
    const handleDisableFromProtected = async () => {
        if (!adminToken || !deleteCandidate) return;
        setActionLoading(deleteCandidate.userId);
        try {
            const res = await fetch(`/api/admin/users/${deleteCandidate.userId}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ action: 'disable' }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to disable user');

            setIsProtectedOpen(false);
            setNotification({
                type: 'success',
                message: `Account ${deleteCandidate.email} has been disabled. Historical records remain intact.`,
            });
            loadData(adminToken);
        } catch (err: any) {
            setNotification({ type: 'error', message: err.message });
        } finally {
            setActionLoading(null);
        }
    };

    // Open Edit Modal
    const handleOpenEdit = (user: UserRecord) => {
        setSelectedUser(user);
        setEditFullName(user.fullName || user.name || '');
        setEditPhone(user.phone || '');
        setEditRole(user.role === 'vendor' ? 'vendor' : 'customer');
        setEditShopId(user.assignedShop?.id || user.shop?.shopId || (availableShops[0]?.shopId ?? ''));
        setEditError(null);
        setIsEditOpen(true);
    };

    // Submit Edit User
    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!adminToken || !selectedUser) return;
        setEditError(null);

        setEditSubmitting(true);
        try {
            const payload: Record<string, any> = {
                action: 'update',
                fullName: editFullName.trim(),
                phone: editPhone.trim(),
                role: editRole,
            };

            if (editRole === 'vendor' && editShopId) {
                payload.shopId = editShopId;
            }

            const res = await fetch(`/api/admin/users/${selectedUser.userId}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update user profile');

            setNotification({ type: 'success', message: 'User profile updated successfully.' });
            setIsEditOpen(false);
            loadData(adminToken);
        } catch (err: any) {
            setEditError(err.message);
        } finally {
            setEditSubmitting(false);
        }
    };

    // Toggle Disable / Enable
    const handleToggleStatus = async (user: UserRecord) => {
        if (!adminToken) return;

        if (user.userId === currentAdminId) {
            setNotification({ type: 'error', message: 'You cannot disable your own administrator account.' });
            return;
        }

        const newAction = user.isDisabled ? 'enable' : 'disable';
        const confirmMsg = user.isDisabled
            ? `Re-enable account for ${user.email}? The user will be permitted to sign in again.`
            : `Disable account for ${user.email}? The user will be blocked from authenticating. Financial records will not be deleted.`;

        if (!window.confirm(confirmMsg)) return;

        setActionLoading(user.userId);
        try {
            const res = await fetch(`/api/admin/users/${user.userId}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ action: newAction }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Failed to ${newAction} user`);

            setNotification({
                type: 'success',
                message: `User ${user.email} ${newAction === 'disable' ? 'disabled' : 'enabled'} successfully.`,
            });
            loadData(adminToken);
        } catch (err: any) {
            setNotification({ type: 'error', message: err.message });
        } finally {
            setActionLoading(null);
        }
    };

    // Trigger Password Reset
    const handleResetPassword = async (user: UserRecord) => {
        if (!adminToken) return;
        setResetLink(null);
        setResetEmail(user.email);
        setCopied(false);

        setActionLoading(user.userId);
        try {
            const res = await fetch(`/api/admin/users/${user.userId}/reset-password`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${adminToken}` },
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to generate password reset link');

            setResetLink(data.link);
            setIsResetOpen(true);
        } catch (err: any) {
            setNotification({ type: 'error', message: err.message });
        } finally {
            setActionLoading(null);
        }
    };

    // Open User Details
    const handleOpenDetail = async (user: UserRecord) => {
        setSelectedUser(user);
        setIsDetailOpen(true);
        setLoadingDetail(true);
        try {
            const res = await fetch(`/api/admin/users/${user.userId}`, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            if (res.ok) {
                const data = await res.json();
                setDetailUser(data.user);
            }
        } catch (e) {
            console.error('[AdminUsers] Failed to fetch details:', e);
        } finally {
            setLoadingDetail(false);
        }
    };

    // Copy reset link to clipboard
    const handleCopyResetLink = () => {
        if (resetLink) {
            navigator.clipboard.writeText(resetLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        }
    };

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.replace('/xad/login');
    };

    if (authError) {
        return (
            <div style={{ maxWidth: '600px', margin: '80px auto', padding: '32px', textAlign: 'center' }}>
                <div style={{ display: 'inline-flex', padding: '16px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', marginBottom: '16px' }}>
                    <Shield size={32} />
                </div>
                <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '8px' }}>Access Denied</h2>
                <p style={{ color: 'var(--fg-muted)', fontSize: '14px', marginBottom: '24px' }}>{authError}</p>
                <Link href="/xad/login" className="btn btn-primary">Return to Sign In</Link>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '1360px', margin: '0 auto', padding: '32px 16px' }}>
            {/* Header Navigation */}
            <AdminHeaderNav
                activeSection="users"
                title="People and shop access"
                description="Manage customer accounts, shop owners, shop assignments, account status, and password resets."
                actions={
                    <button
                        onClick={handleOpenCreate}
                        className="btn btn-primary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                        <Plus size={16} /> Add User
                    </button>
                }
            />

            {/* Notification Banner */}
            {notification && (
                <div style={{
                    marginBottom: '20px',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    background: notification.type === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    border: notification.type === 'success' ? '1px solid rgba(34, 197, 94, 0.25)' : '1px solid rgba(239, 68, 68, 0.25)',
                    color: notification.type === 'success' ? '#16a34a' : '#ef4444',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                    <span style={{ fontSize: '14px', fontWeight: '500' }}>{notification.message}</span>
                    <button onClick={() => setNotification(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* KPI Summary Cards (Requirement 1) */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '16px',
                marginBottom: '24px',
            }}>
                <div className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ padding: '10px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                        <Users size={22} />
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>Total Users</div>
                        <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '2px' }}>{summary.totalUsers}</div>
                    </div>
                </div>

                <div className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ padding: '10px', borderRadius: '10px', background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1' }}>
                        <UserCheck size={22} />
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>Customers</div>
                        <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '2px' }}>{summary.customers}</div>
                    </div>
                </div>

                <div className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ padding: '10px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                        <Store size={22} />
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>Vendors</div>
                        <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '2px' }}>{summary.vendors}</div>
                    </div>
                </div>

                <div className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ padding: '10px', borderRadius: '10px', background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' }}>
                        <CheckCircle2 size={22} />
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>Active</div>
                        <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '2px', color: '#16a34a' }}>{summary.active}</div>
                    </div>
                </div>

                <div className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ padding: '10px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                        <Ban size={22} />
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>Disabled</div>
                        <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '2px', color: summary.disabled > 0 ? '#ef4444' : 'var(--fg)' }}>
                            {summary.disabled}
                        </div>
                    </div>
                </div>
            </div>

            {/* Controls Bar: Search & Filters */}
            <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                    <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px', flex: '1', minWidth: '240px', maxWidth: '420px' }}>
                        <div style={{ position: 'relative', width: '100%' }}>
                            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
                            <input
                                type="text"
                                placeholder="Search by name, email, or phone..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="input"
                                style={{ paddingLeft: '36px', width: '100%' }}
                            />
                        </div>
                        <button type="submit" className="btn btn-secondary btn-sm">Search</button>
                    </form>

                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* Role Filter */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '13px', color: 'var(--fg-muted)', fontWeight: '600' }}>Role:</span>
                            <select
                                value={roleFilter}
                                onChange={e => handleRoleFilterChange(e.target.value)}
                                className="input"
                                style={{ padding: '6px 12px', fontSize: '13px' }}
                            >
                                <option value="all">All Roles</option>
                                <option value="customer">Customers</option>
                                <option value="vendor">Vendors</option>
                                <option value="admin">Admins</option>
                            </select>
                        </div>

                        {/* Status Filter */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '13px', color: 'var(--fg-muted)', fontWeight: '600' }}>Status:</span>
                            <select
                                value={statusFilter}
                                onChange={e => handleStatusFilterChange(e.target.value)}
                                className="input"
                                style={{ padding: '6px 12px', fontSize: '13px' }}
                            >
                                <option value="all">All Statuses</option>
                                <option value="active">Active</option>
                                <option value="disabled">Disabled</option>
                            </select>
                        </div>

                        <button
                            onClick={() => adminToken && loadData(adminToken)}
                            className="btn btn-secondary btn-sm"
                            disabled={loading}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                        </button>
                    </div>
                </div>
            </div>

            {/* Users & Vendors Table (Requirement 1) */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                        <thead>
                            <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                <th style={{ padding: '12px 16px', fontWeight: '700', color: 'var(--fg-muted)' }}>Name</th>
                                <th style={{ padding: '12px 16px', fontWeight: '700', color: 'var(--fg-muted)' }}>Email</th>
                                <th style={{ padding: '12px 16px', fontWeight: '700', color: 'var(--fg-muted)' }}>Phone</th>
                                <th style={{ padding: '12px 16px', fontWeight: '700', color: 'var(--fg-muted)' }}>Role</th>
                                <th style={{ padding: '12px 16px', fontWeight: '700', color: 'var(--fg-muted)' }}>Assigned Shop</th>
                                <th style={{ padding: '12px 16px', fontWeight: '700', color: 'var(--fg-muted)' }}>Account Status</th>
                                <th style={{ padding: '12px 16px', fontWeight: '700', color: 'var(--fg-muted)' }}>Created</th>
                                <th style={{ padding: '12px 16px', fontWeight: '700', color: 'var(--fg-muted)', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={8} style={{ padding: '48px', textAlign: 'center', color: 'var(--fg-muted)' }}>
                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                                            <span className="spinner" /> Loading user directory...
                                        </div>
                                    </td>
                                </tr>
                            ) : users.length === 0 ? (
                                <tr>
                                    <td colSpan={8} style={{ padding: '48px', textAlign: 'center', color: 'var(--fg-muted)' }}>
                                        No users found matching your filters.
                                    </td>
                                </tr>
                            ) : (
                                users.map(u => {
                                    const shop = u.assignedShop || u.shop;
                                    return (
                                        <tr key={u.userId} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }}>
                                            {/* Name */}
                                            <td style={{ padding: '14px 16px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <div style={{
                                                        width: '32px',
                                                        height: '32px',
                                                        borderRadius: '50%',
                                                        background: u.role === 'admin' ? '#f59e0b' : u.role === 'vendor' ? '#10b981' : 'var(--accent)',
                                                        color: '#fff',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontWeight: '700',
                                                        fontSize: '13px',
                                                        flexShrink: 0,
                                                    }}>
                                                        {(u.name || u.email || '?')[0].toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: '600', color: 'var(--fg)' }}>{u.name || '—'}</div>
                                                        {u.orderCount > 0 && (
                                                            <div style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>{u.orderCount} orders</div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Email */}
                                            <td style={{ padding: '14px 16px', color: 'var(--fg-muted)' }}>
                                                {u.email || '—'}
                                            </td>

                                            {/* Phone */}
                                            <td style={{ padding: '14px 16px', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                                                {u.phone || '—'}
                                            </td>

                                            {/* Role */}
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{
                                                    display: 'inline-block',
                                                    padding: '3px 8px',
                                                    borderRadius: '12px',
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    textTransform: 'uppercase',
                                                    background:
                                                        u.role === 'admin' ? 'rgba(245, 158, 11, 0.15)' :
                                                        u.role === 'vendor' ? 'rgba(16, 185, 129, 0.15)' :
                                                        'rgba(59, 130, 246, 0.15)',
                                                    color:
                                                        u.role === 'admin' ? '#d97706' :
                                                        u.role === 'vendor' ? '#059669' :
                                                        '#2563eb',
                                                }}>
                                                    {u.role}
                                                </span>
                                            </td>

                                            {/* Assigned Shop */}
                                            <td style={{ padding: '14px 16px' }}>
                                                {shop ? (
                                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--fg)' }}>
                                                        <Store size={14} style={{ color: '#10b981' }} />
                                                        <span style={{ fontWeight: '500' }}>{(shop as any).shopName || (shop as any).name}</span>
                                                    </div>
                                                ) : (
                                                    <span style={{ color: 'var(--fg-muted)' }}>—</span>
                                                )}
                                            </td>

                                            {/* Account Status */}
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '5px',
                                                    padding: '3px 8px',
                                                    borderRadius: '12px',
                                                    fontSize: '12px',
                                                    fontWeight: '600',
                                                    background: u.isDisabled ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                                                    color: u.isDisabled ? '#ef4444' : '#16a34a',
                                                }}>
                                                    {u.isDisabled ? (
                                                        <><XCircle size={12} /> Disabled</>
                                                    ) : (
                                                        <><CheckCircle2 size={12} /> Active</>
                                                    )}
                                                </span>
                                            </td>

                                            {/* Created */}
                                            <td style={{ padding: '14px 16px', color: 'var(--fg-muted)', fontSize: '13px', whiteSpace: 'nowrap' }}>
                                                {new Date(u.createdAt || u.created).toLocaleDateString()}
                                            </td>

                                            {/* Actions */}
                                            <td style={{ padding: '14px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                                                    {/* Details Button */}
                                                    <button
                                                        onClick={() => handleOpenDetail(u)}
                                                        className="btn btn-secondary btn-sm"
                                                        title="View user details & order history"
                                                        style={{ padding: '6px 8px' }}
                                                    >
                                                        <Eye size={13} />
                                                    </button>

                                                    {/* Edit Button */}
                                                    <button
                                                        onClick={() => handleOpenEdit(u)}
                                                        className="btn btn-secondary btn-sm"
                                                        title="Edit profile & assignments"
                                                        disabled={u.role === 'admin'}
                                                        style={{ padding: '6px 8px' }}
                                                    >
                                                        <Edit2 size={13} />
                                                    </button>

                                                    {/* Disable / Enable Button */}
                                                    <button
                                                        onClick={() => handleToggleStatus(u)}
                                                        className="btn btn-secondary btn-sm"
                                                        title={u.isDisabled ? 'Re-enable account' : 'Disable account'}
                                                        disabled={actionLoading === u.userId || u.userId === currentAdminId || u.role === 'admin'}
                                                        style={{
                                                            padding: '6px 8px',
                                                            color: u.isDisabled ? '#16a34a' : '#ef4444',
                                                        }}
                                                    >
                                                        {actionLoading === u.userId ? (
                                                            <span className="spinner" style={{ width: '12px', height: '12px' }} />
                                                        ) : u.isDisabled ? (
                                                            <CheckCircle2 size={13} />
                                                        ) : (
                                                            <Ban size={13} />
                                                        )}
                                                    </button>

                                                    {/* Reset Password Button */}
                                                    <button
                                                        onClick={() => handleResetPassword(u)}
                                                        className="btn btn-secondary btn-sm"
                                                        title="Generate secure password reset link"
                                                        disabled={actionLoading === u.userId}
                                                        style={{ padding: '6px 8px' }}
                                                    >
                                                        <RotateCcw size={13} />
                                                    </button>

                                                    {/* Delete Account Button */}
                                                    <button
                                                        onClick={() => handleOpenDelete(u)}
                                                        className="btn btn-secondary btn-sm"
                                                        title={u.role === 'admin' ? 'Administrator accounts cannot be deleted' : 'Delete user account'}
                                                        disabled={actionLoading === u.userId || u.userId === currentAdminId || u.role === 'admin'}
                                                        style={{
                                                            padding: '6px 8px',
                                                            color: (u.role === 'admin' || u.userId === currentAdminId) ? 'var(--fg-muted)' : '#ef4444',
                                                            opacity: (u.role === 'admin' || u.userId === currentAdminId) ? 0.35 : 1,
                                                        }}
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ─────────────────────────────────────────────────────────────
                MODAL 1: ADD USER (Requirement 2 & 3)
               ───────────────────────────────────────────────────────────── */}
            {isCreateOpen && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    padding: '16px',
                }}>
                    <div className="card" style={{ maxWidth: '520px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <div>
                                <h3 style={{ fontSize: '18px', fontWeight: '800' }}>Create New Account</h3>
                                <p style={{ fontSize: '12px', color: 'var(--fg-muted)', marginTop: '2px' }}>
                                    {createRole === 'customer'
                                        ? 'Create a new customer account for ordering and tracking prints.'
                                        : 'Create a vendor account and initialize their dedicated print shop.'}
                                </p>
                            </div>
                            <button onClick={() => setIsCreateOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)' }}>
                                <X size={18} />
                            </button>
                        </div>

                        {createError && (
                            <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: '13px' }}>
                                {createError}
                            </div>
                        )}

                        <form onSubmit={handleCreateSubmit}>
                            {/* Account Type Selector (Segmented) */}
                            <div style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>Account Type *</label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                                    <button
                                        type="button"
                                        onClick={() => setCreateRole('customer')}
                                        style={{
                                            padding: '8px 12px',
                                            borderRadius: '8px',
                                            border: 'none',
                                            background: createRole === 'customer' ? 'var(--accent)' : 'transparent',
                                            color: createRole === 'customer' ? '#fff' : 'var(--fg-muted)',
                                            fontWeight: '700',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '6px',
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        <UserCheck size={16} /> Customer
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCreateRole('vendor')}
                                        style={{
                                            padding: '8px 12px',
                                            borderRadius: '8px',
                                            border: 'none',
                                            background: createRole === 'vendor' ? '#10b981' : 'transparent',
                                            color: createRole === 'vendor' ? '#fff' : 'var(--fg-muted)',
                                            fontWeight: '700',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '6px',
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        <Store size={16} /> Vendor
                                    </button>
                                </div>
                            </div>

                            {/* Credentials and Details */}
                            <div style={{ marginBottom: '14px' }}>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>Full Name</label>
                                <input
                                    type="text"
                                    value={createFullName}
                                    onChange={e => setCreateFullName(e.target.value)}
                                    className="input"
                                    style={{ width: '100%' }}
                                    placeholder={createRole === 'vendor' ? 'e.g. Ramesh Kumar' : 'e.g. Priya Sharma'}
                                />
                            </div>

                            <div style={{ marginBottom: '14px' }}>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>Email Address *</label>
                                <input
                                    type="email"
                                    value={createEmail}
                                    onChange={e => setCreateEmail(e.target.value)}
                                    className="input"
                                    style={{ width: '100%' }}
                                    required
                                    placeholder="user@example.com"
                                />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                                        Mobile Phone <span style={{ fontWeight: '400', color: 'var(--fg-muted)', fontSize: '11px' }}>(Optional)</span>
                                    </label>
                                    <input
                                        type="tel"
                                        value={createPhone}
                                        onChange={e => setCreatePhone(e.target.value)}
                                        className="input"
                                        style={{ width: '100%' }}
                                        placeholder="9876543210"
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>Temporary Password *</label>
                                    <input
                                        type="password"
                                        value={createPassword}
                                        onChange={e => setCreatePassword(e.target.value)}
                                        className="input"
                                        style={{ width: '100%' }}
                                        required
                                        minLength={6}
                                        placeholder="Min. 6 characters"
                                    />
                                </div>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginBottom: '16px', marginTop: '-6px' }}>
                                Passwords are encrypted by Supabase Auth and never stored in plain text.
                            </div>

                            {/* Vendor Print Shop Details Section */}
                            {createRole === 'vendor' && (
                                <div style={{
                                    marginTop: '16px',
                                    marginBottom: '16px',
                                    padding: '14px',
                                    borderRadius: '8px',
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border)',
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        marginBottom: '12px',
                                        color: '#10b981',
                                        fontWeight: '700',
                                        fontSize: '12px',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.05em',
                                    }}>
                                        <Store size={15} /> Print Shop Details
                                    </div>

                                    <div style={{ marginBottom: '10px' }}>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                                            Shop Name *
                                        </label>
                                        <input
                                            type="text"
                                            value={createShopName}
                                            onChange={e => setCreateShopName(e.target.value)}
                                            className="input"
                                            style={{ width: '100%' }}
                                            required
                                            placeholder="e.g. Apex Xerox & Print Hub"
                                        />
                                    </div>

                                    <div style={{ marginBottom: '10px' }}>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                                            Shop Address / Location *
                                        </label>
                                        <input
                                            type="text"
                                            value={createShopAddress}
                                            onChange={e => setCreateShopAddress(e.target.value)}
                                            className="input"
                                            style={{ width: '100%' }}
                                            required
                                            placeholder="e.g. 14 Gandhi Nagar, Near New Bus Stand, Salem"
                                        />
                                    </div>

                                    <div style={{ marginBottom: '10px' }}>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                                            Shop Contact Number <span style={{ fontWeight: '400', color: 'var(--fg-muted)' }}>(Optional)</span>
                                        </label>
                                        <input
                                            type="tel"
                                            value={createShopContactPhone}
                                            onChange={e => setCreateShopContactPhone(e.target.value)}
                                            className="input"
                                            style={{ width: '100%' }}
                                            placeholder="e.g. 0427-2345678 or 9876543210"
                                        />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                                                Opening Time *
                                            </label>
                                            <input
                                                type="time"
                                                value={createOpeningTime}
                                                onChange={e => setCreateOpeningTime(e.target.value)}
                                                className="input"
                                                style={{ width: '100%' }}
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                                                Closing Time *
                                            </label>
                                            <input
                                                type="time"
                                                value={createClosingTime}
                                                onChange={e => setCreateClosingTime(e.target.value)}
                                                className="input"
                                                style={{ width: '100%' }}
                                                required
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                                <button type="button" onClick={() => setIsCreateOpen(false)} className="btn btn-secondary">
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={createSubmitting}
                                    style={{
                                        background: createRole === 'vendor' ? '#10b981' : undefined,
                                        borderColor: createRole === 'vendor' ? '#10b981' : undefined,
                                    }}
                                >
                                    {createSubmitting ? 'Creating...' : createRole === 'vendor' ? 'Create Vendor & Print Shop' : 'Create Customer'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                MODAL 2: EDIT USER (Requirement 4)
               ───────────────────────────────────────────────────────────── */}
            {isEditOpen && selectedUser && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    padding: '16px',
                }}>
                    <div className="card" style={{ maxWidth: '480px', width: '100%', padding: '24px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h3 style={{ fontSize: '18px', fontWeight: '800' }}>Edit User Profile</h3>
                            <button onClick={() => setIsEditOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)' }}>
                                <X size={18} />
                            </button>
                        </div>

                        {editError && (
                            <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: '13px' }}>
                                {editError}
                            </div>
                        )}

                        <form onSubmit={handleEditSubmit}>
                            <div style={{ marginBottom: '14px' }}>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>Email</label>
                                <input
                                    type="text"
                                    value={selectedUser.email || ''}
                                    disabled
                                    className="input"
                                    style={{ width: '100%', opacity: 0.7, cursor: 'not-allowed' }}
                                />
                            </div>

                            <div style={{ marginBottom: '14px' }}>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>Full Name</label>
                                <input
                                    type="text"
                                    value={editFullName}
                                    onChange={e => setEditFullName(e.target.value)}
                                    className="input"
                                    style={{ width: '100%' }}
                                />
                            </div>

                            <div style={{ marginBottom: '14px' }}>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>Phone</label>
                                <input
                                    type="tel"
                                    value={editPhone}
                                    onChange={e => setEditPhone(e.target.value)}
                                    className="input"
                                    style={{ width: '100%' }}
                                    placeholder="+91 9876543210"
                                />
                            </div>

                            <div style={{ marginBottom: '14px' }}>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>Role</label>
                                <select
                                    value={editRole}
                                    onChange={e => setEditRole(e.target.value as 'customer' | 'vendor')}
                                    className="input"
                                    style={{ width: '100%' }}
                                >
                                    <option value="customer">Customer</option>
                                    <option value="vendor">Vendor</option>
                                </select>
                                <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginTop: '4px' }}>
                                    Administrator role cannot be assigned through this interface.
                                </div>
                            </div>

                            {editRole === 'vendor' && (
                                <div style={{ marginBottom: '16px' }}>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>Assigned Shop</label>
                                    <select
                                        value={editShopId}
                                        onChange={e => setEditShopId(e.target.value)}
                                        className="input"
                                        style={{ width: '100%' }}
                                    >
                                        <option value="">-- No shop assigned --</option>
                                        {availableShops.map(s => (
                                            <option key={s.shopId} value={s.shopId}>
                                                {s.shopName} ({s.shopStatus})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                                <button type="button" onClick={() => setIsEditOpen(false)} className="btn btn-secondary">
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={editSubmitting}>
                                    {editSubmitting ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                MODAL 3: PASSWORD RESET LINK (Requirement 6)
               ───────────────────────────────────────────────────────────── */}
            {isResetOpen && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    padding: '16px',
                }}>
                    <div className="card" style={{ maxWidth: '520px', width: '100%', padding: '24px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <RotateCcw size={18} style={{ color: 'var(--accent)' }} />
                                <h3 style={{ fontSize: '18px', fontWeight: '800' }}>Password Reset Link Generated</h3>
                            </div>
                            <button onClick={() => setIsResetOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)' }}>
                                <X size={18} />
                            </button>
                        </div>

                        <p style={{ fontSize: '13px', color: 'var(--fg-muted)', marginBottom: '16px' }}>
                            A secure, one-time Supabase Auth password recovery link has been generated for <strong>{resetEmail}</strong>. Provide this link to the user to allow them to securely set a new password:
                        </p>

                        <div style={{
                            padding: '12px',
                            background: 'var(--bg-secondary)',
                            borderRadius: '8px',
                            border: '1px solid var(--border)',
                            wordBreak: 'break-all',
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            marginBottom: '16px',
                            maxHeight: '120px',
                            overflowY: 'auto',
                        }}>
                            {resetLink}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '12px', color: 'var(--fg-muted)' }}>
                                Link is authoritative and time-limited.
                            </span>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    onClick={handleCopyResetLink}
                                    className="btn btn-primary btn-sm"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                >
                                    {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy Link</>}
                                </button>
                                <button onClick={() => setIsResetOpen(false)} className="btn btn-secondary btn-sm">
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                DRAWER / MODAL 4: USER DETAILS & ORDER HISTORY
               ───────────────────────────────────────────────────────────── */}
            {isDetailOpen && selectedUser && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    padding: '16px',
                }}>
                    <div className="card" style={{ maxWidth: '640px', width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: '24px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h3 style={{ fontSize: '18px', fontWeight: '800' }}>Account Details</h3>
                            <button onClick={() => setIsDetailOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)' }}>
                                <X size={18} />
                            </button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px', fontSize: '13px' }}>
                            <div><strong>Name:</strong> {selectedUser.name || '—'}</div>
                            <div><strong>Email:</strong> {selectedUser.email || '—'}</div>
                            <div><strong>Phone:</strong> {selectedUser.phone || '—'}</div>
                            <div><strong>Role:</strong> <span style={{ textTransform: 'uppercase', fontWeight: '700' }}>{selectedUser.role}</span></div>
                            <div><strong>Status:</strong> {selectedUser.isDisabled ? 'Disabled' : 'Active'}</div>
                            <div><strong>Total Orders:</strong> {selectedUser.orderCount}</div>
                            <div style={{ gridColumn: 'span 2' }}>
                                <strong>Shop:</strong> {selectedUser.assignedShop?.name || (selectedUser.shop as any)?.shopName || 'None assigned'}
                            </div>
                            <div style={{ gridColumn: 'span 2', color: 'var(--fg-muted)', fontSize: '12px' }}>
                                <strong>User ID:</strong> <span style={{ fontFamily: 'monospace' }}>{selectedUser.userId}</span>
                            </div>
                        </div>

                        <h4 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '10px' }}>Recent Orders</h4>
                        {loadingDetail ? (
                            <div style={{ textAlign: 'center', padding: '20px' }}><span className="spinner" /></div>
                        ) : detailUser?.recentOrders?.length > 0 ? (
                            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                                <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                                    <thead style={{ background: 'var(--bg-secondary)' }}>
                                        <tr>
                                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Order #</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Status</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Amount</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Date</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detailUser.recentOrders.map((o: any) => (
                                            <tr key={o.id} style={{ borderTop: '1px solid var(--border)' }}>
                                                <td style={{ padding: '8px 12px', fontWeight: '600' }}>{o.order_number || o.id.slice(0, 8)}</td>
                                                <td style={{ padding: '8px 12px' }}>{o.status}</td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>₹{Number(o.total_amount).toFixed(2)}</td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{new Date(o.created_at).toLocaleDateString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: '13px', border: '1px dashed var(--border)', borderRadius: '8px' }}>
                                No historical orders found for this user.
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                            <button onClick={() => setIsDetailOpen(false)} className="btn btn-secondary">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                MODAL 5: DELETE CONFIRMATION MODAL ("Delete Account?")
               ───────────────────────────────────────────────────────────── */}
            {isDeleteOpen && deleteCandidate && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    padding: '16px',
                }}>
                    <div className="card" style={{ maxWidth: '440px', width: '100%', padding: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '50%',
                                background: 'rgba(239, 68, 68, 0.15)',
                                color: '#ef4444',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}>
                                <AlertCircle size={22} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: '17px', fontWeight: '800', color: 'var(--fg)' }}>Delete Account?</h3>
                                <p style={{ fontSize: '12px', color: 'var(--fg-muted)', marginTop: '2px' }}>This action is permanent and cannot be undone.</p>
                            </div>
                        </div>

                        <p style={{ fontSize: '13px', color: 'var(--fg-muted)', lineHeight: '1.5', marginBottom: '16px' }}>
                            Are you sure you want to permanently delete the account for <strong>{deleteCandidate.fullName || deleteCandidate.name || deleteCandidate.email}</strong> (<span style={{ fontFamily: 'monospace' }}>{deleteCandidate.email}</span>)?
                        </p>

                        {deleteCandidate.role === 'vendor' && (
                            <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#d97706', fontSize: '12px', marginBottom: '16px' }}>
                                Note: Any empty print shop assigned to this vendor will also be removed. Accounts with order history or financial transactions cannot be deleted.
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                            <button
                                type="button"
                                onClick={() => setIsDeleteOpen(false)}
                                className="btn btn-secondary"
                                disabled={deleteSubmitting}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmDelete}
                                className="btn"
                                disabled={deleteSubmitting}
                                style={{
                                    background: '#ef4444',
                                    color: '#fff',
                                    borderColor: '#ef4444',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                }}
                            >
                                {deleteSubmitting ? (
                                    <><span className="spinner" style={{ width: '12px', height: '12px' }} /> Deleting...</>
                                ) : (
                                    <><Trash2 size={14} /> Delete Account</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                MODAL 6: PROTECTED ACCOUNT CANNOT BE DELETED MODAL
               ───────────────────────────────────────────────────────────── */}
            {isProtectedOpen && deleteCandidate && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    padding: '16px',
                }}>
                    <div className="card" style={{ maxWidth: '480px', width: '100%', padding: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '50%',
                                background: 'rgba(239, 68, 68, 0.15)',
                                color: '#ef4444',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}>
                                <Shield size={22} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: '17px', fontWeight: '800', color: 'var(--fg)' }}>Account Cannot Be Permanently Deleted</h3>
                                <p style={{ fontSize: '12px', color: '#ef4444', fontWeight: '600', marginTop: '2px' }}>Protected Historical Records Found</p>
                            </div>
                        </div>

                        <p style={{ fontSize: '13px', color: 'var(--fg-muted)', lineHeight: '1.5', marginBottom: '14px' }}>
                            The account for <strong>{deleteCandidate.email}</strong> is tied to existing financial, ledger, receipt, or order audit records. Deleting this account would corrupt data integrity.
                        </p>

                        {protectedDetails && (
                            <div style={{
                                padding: '12px 14px',
                                borderRadius: '8px',
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border)',
                                marginBottom: '16px',
                                fontSize: '12px',
                            }}>
                                <div style={{ fontWeight: '700', marginBottom: '8px', color: 'var(--fg)' }}>Retained Audit Records:</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', color: 'var(--fg-muted)' }}>
                                    <div>• Customer Orders: <strong>{protectedDetails.userOrders ?? 0}</strong></div>
                                    {protectedDetails.vendorShopOrders > 0 && (
                                        <div>• Shop Orders: <strong>{protectedDetails.vendorShopOrders}</strong></div>
                                    )}
                                    <div>• Financial Ledger: <strong>{protectedDetails.ledgerEntries ?? 0}</strong></div>
                                    <div>• Order Receipts: <strong>{protectedDetails.receipts ?? 0}</strong></div>
                                    <div>• Refund Requests: <strong>{protectedDetails.refundRequests ?? 0}</strong></div>
                                    <div>• Wallet Records: <strong>{protectedDetails.walletTransactions ?? 0}</strong></div>
                                </div>
                            </div>
                        )}

                        <p style={{ fontSize: '13px', color: 'var(--fg)', marginBottom: '20px' }}>
                            You can <strong>disable the account</strong> instead. This immediately revokes sign-in access while keeping all financial and audit records strictly intact.
                        </p>

                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                onClick={() => setIsProtectedOpen(false)}
                                className="btn btn-secondary"
                            >
                                Close
                            </button>
                            {!deleteCandidate.isDisabled && (
                                <button
                                    type="button"
                                    onClick={handleDisableFromProtected}
                                    className="btn"
                                    disabled={actionLoading === deleteCandidate.userId}
                                    style={{
                                        background: '#ef4444',
                                        color: '#fff',
                                        borderColor: '#ef4444',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                    }}
                                >
                                    {actionLoading === deleteCandidate.userId ? (
                                        <><span className="spinner" style={{ width: '12px', height: '12px' }} /> Disabling...</>
                                    ) : (
                                        <><Ban size={14} /> Disable Account</>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
