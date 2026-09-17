'use client';

import { notify } from '@/components/ui/Feedback';
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { Order, CustomerOrder } from '@/types/orders';
import type { PrintDocument } from '@/lib/print-order';
import { supabase } from '@/lib/supabase/client';

export type UserType = 'customer' | 'vendor' | 'admin' | 'unverified';

export interface User {
    id: string;
    mobile: string;
    email?: string;
    name: string;
    avatarUrl?: string;
    whatsappLinkStatus?: 'not_linked' | 'pending' | 'linked';
    whatsappLinkedMobile?: string;
    type: UserType;
    xerCoins: number;
}

const CART_EXPIRY_MS = 12 * 60 * 60 * 1000;

interface CartItem {
    orderId?: string;
    orderNumber?: string;
    documents?: PrintDocument[];
    shopId: string;
    shopName: string;
    fileName: string;
    fileNames?: string[];
    pages: number;
    color: boolean;
    sides: 'single' | 'double' | 'double_long' | 'double_short';
    orientation: 'portrait' | 'landscape';
    copies: number;
    totalAmount: number;
    createdAt: string;
    source?: 'upload' | 'whatsapp';
}

interface OrderState {
    orderId?: string;
    orderNumber?: string;
    editingCartCreatedAt?: string;
    documents?: PrintDocument[];
    shopId: string;
    shopName: string;
    file: File | null;
    files: File[];
    totalFiles: number;
    totalEstimatedPages: number;
    fileName: string;
    pages: number;
    color: boolean;
    sides: 'single' | 'double' | 'double_long' | 'double_short';
    orientation: 'portrait' | 'landscape';
    copies: number;
    method: 'instant' | 'scheduled';
    scheduledTime: string;
    uploadedAt: string;
    totalAmount: number;
    paymentMethod: 'upi' | 'card' | 'wallet';
}

interface AppContextType {
    user: User | null;
    isLoggedIn: boolean;
    authInitialized: boolean;
    isAuthLoading: boolean;
    login: (mobile: string, name: string, type: UserType, data?: Partial<Pick<User, 'id' | 'email' | 'avatarUrl'>>) => void;
    logout: () => Promise<void> | void;
    orders: Order[];
    addOrder: (order: Order) => void;
    currentOrder: OrderState;
    setCurrentOrder: React.Dispatch<React.SetStateAction<OrderState>>;
    lastOrderId: string;
    setLastOrderId: (id: string) => void;
    cart: CartItem[];
    addToCart: (item: Omit<CartItem, 'createdAt'> & Partial<Pick<CartItem, 'createdAt'>>) => void;
    removeFromCart: (idx: number) => void;
    isLoading: boolean;
    theme: 'light' | 'dark';
    toggleTheme: () => void;
    updateProfile: (data: Partial<User>) => Promise<void> | void;
    addXerCoins: (amount: number) => boolean;
    setXerCoinsBalance: (balance: number) => boolean;
    refreshProfile: () => Promise<void>;
    refreshOrders: () => Promise<void>;
    refreshWallet: () => Promise<void>;
}

const defaultOrder: OrderState = {
    documents: [],
    shopId: '', shopName: '', file: null, files: [], totalFiles: 0, totalEstimatedPages: 0, fileName: '',
    pages: 1, color: false, sides: 'single', orientation: 'portrait',
    copies: 1, method: 'instant', scheduledTime: '', uploadedAt: '',
    totalAmount: 0,
    paymentMethod: 'upi',
};

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [currentOrder, setCurrentOrder] = useState<OrderState>(defaultOrder);
    const [lastOrderId, setLastOrderId] = useState('');
    const [cart, setCart] = useState<CartItem[]>([]);
    const [cartReady, setCartReady] = useState(false);
    const [cartOwner, setCartOwner] = useState<string | null>(null);
    const [authInitialized, setAuthInitialized] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [themeReady, setThemeReady] = useState(false);

    // The head script restores the theme before the first paint.
    useEffect(() => {
        setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
        setThemeReady(true);
    }, []);

    // Apply theme
    useEffect(() => {
        if (!themeReady) return;
        document.documentElement.classList.toggle('dark', theme === 'dark');
        document.documentElement.style.colorScheme = theme;
        try { localStorage.setItem('xer_theme', theme); } catch { }
    }, [theme, themeReady]);

    const toggleTheme = () => {
        if (typeof document !== 'undefined' && 'startViewTransition' in document) {
            (document as any).startViewTransition(() => {
                setTheme(prev => prev === 'light' ? 'dark' : 'light');
            });
        } else {
            setTheme(prev => prev === 'light' ? 'dark' : 'light');
        }
    };

    const fetchProfile = async (userId: string, authUser?: any): Promise<User> => {
        try {
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('id, user_id, full_name, phone, avatar_url, role')
                .eq('user_id', userId)
                .maybeSingle();

            if (error) {
                console.warn('[AppContext] Supabase profile fetch error:', error.message);
            }

            const role: UserType = !error && ['customer', 'vendor', 'admin'].includes(profile?.role) ? profile!.role : 'unverified';
            const name = profile?.full_name || authUser?.user_metadata?.full_name || (authUser?.email ? authUser.email.split('@')[0] : '') || (authUser?.phone ? `User (${authUser.phone.slice(-4)})` : 'Customer');
            const mobile = profile?.phone || authUser?.phone || '';
            const email = (profile as any)?.email || authUser?.email || '';
            const avatarUrl = profile?.avatar_url || authUser?.user_metadata?.avatar_url || '';

            return {
                id: userId,
                name,
                email,
                mobile,
                avatarUrl,
                type: role,
                xerCoins: 0,
                whatsappLinkStatus: 'not_linked',
            };
        } catch (err) {
            console.error('[AppContext] Failed to load profile:', err);
            return {
                id: userId,
                name: authUser?.user_metadata?.full_name || (authUser?.email ? authUser.email.split('@')[0] : '') || (authUser?.phone ? `User (${authUser.phone.slice(-4)})` : 'Customer'),
                email: authUser?.email || '',
                mobile: authUser?.phone || '',
                avatarUrl: authUser?.user_metadata?.avatar_url || '',
                type: 'unverified',
                xerCoins: 0,
                whatsappLinkStatus: 'not_linked',
            };
        }
    };

    const fetchWalletBalance = useCallback(async (token?: string): Promise<number> => {
        try {
            let authToken = token;
            if (!authToken) {
                const { data: { session } } = await supabase.auth.getSession();
                authToken = session?.access_token;
            }
            if (!authToken) return 0;

            const res = await fetch('/api/customer/wallet', {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) return 0;
            const data = await res.json();
            const balance = Number(data.balance);
            return Number.isFinite(balance) ? balance : 0;
        } catch (err) {
            console.error('[AppContext] Failed to fetch wallet balance:', err);
            return 0;
        }
    }, []);

    const fetchCustomerOrders = useCallback(async (token?: string) => {
        try {
            let authToken = token;
            if (!authToken) {
                const { data: { session } } = await supabase.auth.getSession();
                authToken = session?.access_token;
            }
            if (!authToken) {
                setOrders([]);
                return;
            }

            const res = await fetch('/api/customer/orders', {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) return;

            const data = await res.json();
            if (Array.isArray(data.orders)) {
                const mapped: Order[] = data.orders.map((o: any) => {
                    const firstFile = o.order_files?.[0];
                    const ps = firstFile?.print_settings;
                    return {
                        id: o.id,
                        orderNumber: o.order_number,
                        shopId: o.shop_id,
                        shopName: o.shop?.name || 'Print Shop',
                        fileName: firstFile?.original_filename || (o.order_files?.length ? `${o.order_files.length} files` : 'Document'),
                        files: o.order_files?.map((f: any) => ({
                            name: f.original_filename,
                            pages: f.printable_pages || 1,
                            color: f.print_settings?.colour_mode === 'COLOUR',
                        })),
                        pages: o.total_printable_pages || 1,
                        color: ps?.colour_mode === 'COLOUR',
                        sides: ps?.sides?.startsWith('DOUBLE') ? 'double' : 'single',
                        orientation: ps?.orientation?.toLowerCase() === 'landscape' ? 'landscape' : 'portrait',
                        copies: ps?.copies || 1,
                        method: 'instant',
                        paymentStatus: o.payment_status,
                        totalAmount: Number(o.total_amount) || 0,
                        status: o.status,
                        createdAt: o.created_at,
                        customerMobile: '',
                        rawOrder: o,
                    };
                });
                setOrders(mapped);
            }
        } catch (err) {
            console.error('[AppContext] Failed to fetch customer orders:', err);
        }
    }, []);

    const refreshWallet = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        const balance = await fetchWalletBalance(session.access_token);
        setUser(prev => {
            if (!prev) return null;
            const updated = { ...prev, xerCoins: balance };
            try { localStorage.setItem('xer_user', JSON.stringify(updated)); } catch { }
            return updated;
        });
    }, [fetchWalletBalance]);

    const refreshProfile = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            const loaded = await fetchProfile(session.user.id, session.user);
            const balance = loaded.type === 'customer' ? await fetchWalletBalance(session.access_token) : 0;
            loaded.xerCoins = balance;
            setUser(loaded);
            try { localStorage.setItem('xer_user', JSON.stringify(loaded)); } catch { }
            if (loaded.type === 'customer') await fetchCustomerOrders(session.access_token);
            else setOrders([]);
        } else {
            setUser(null);
            setOrders([]);
            try { localStorage.removeItem('xer_user'); } catch { }
        }
    }, [fetchCustomerOrders, fetchWalletBalance]);

    // Auth callbacks must return before making further Supabase calls (auth holds a lock).
    useEffect(() => {
        let mounted = true;
        let revision = 0;
        let timer: ReturnType<typeof setTimeout>;
        const restore = async () => {
            const current = ++revision;
            try {
                const { data: { session }, error } = await supabase.auth.getSession();
                if (error) throw error;
                const loaded = session?.user ? await fetchProfile(session.user.id, session.user) : null;
                if (!mounted || current !== revision) return;
                setUser(loaded);
                setOrders([]);
                if (loaded?.type === 'customer' && session) {
                    void fetchWalletBalance(session.access_token).then(balance => {
                        if (mounted && current === revision) setUser(prev => prev?.id === loaded.id ? { ...prev, xerCoins: balance } : prev);
                    });
                    void fetchCustomerOrders(session.access_token);
                }
            } catch {
                if (mounted && current === revision) { setUser(null); setOrders([]); }
            } finally {
                if (mounted && current === revision) { setAuthInitialized(true); setIsLoading(false); }
            }
        };
        void restore();
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (!mounted) return;
            if (event === 'SIGNED_OUT') {
                revision++;
                setUser(null); setOrders([]); setCart([]);
                setCurrentOrder({ ...defaultOrder, files: [] });
                setLastOrderId(''); setAuthInitialized(true); setIsLoading(false);
                try { localStorage.removeItem('xer_user'); } catch {}
            } else if (['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
                clearTimeout(timer);
                timer = setTimeout(() => { void restore(); }, 0);
            }
        });
        return () => { mounted = false; revision++; clearTimeout(timer); subscription.unsubscribe(); };
    }, [fetchCustomerOrders, fetchWalletBalance]);

    const cartUserId = user?.id || null;
    const cartUserIsCustomer = user?.type === 'customer';

    useEffect(() => {
        try {
            if (!authInitialized) return;
            const savedCart = cartUserIsCustomer && cartUserId ? localStorage.getItem(`xer_cart:${cartUserId}`) : null;
            const parsedCart = savedCart ? JSON.parse(savedCart) as CartItem[] : [];
            const now = Date.now();
            setCart(parsedCart.filter(item => {
                const createdAt = new Date(item.createdAt || 0).getTime();
                return Number.isFinite(createdAt) && now - createdAt < CART_EXPIRY_MS;
            }));
        } catch {
            setCart([]);
        } finally {
            setCartOwner(cartUserId);
            setCartReady(authInitialized);
        }
    }, [authInitialized, cartUserId, cartUserIsCustomer]);

    useEffect(() => {
        if (!cartReady || !user || cartOwner !== user.id) return;
        try { localStorage.setItem(`xer_cart:${user.id}`, JSON.stringify(cart, (key, value) => key === 'file' ? undefined : value)); } catch {}
    }, [cart, cartReady, cartOwner, user?.id]);

    useEffect(() => {
        if (!cartReady) return;
        const clearExpiredCart = () => {
            const now = Date.now();
            setCart(prev => prev.filter(item => {
                const createdAt = new Date(item.createdAt || 0).getTime();
                return Number.isFinite(createdAt) && now - createdAt < CART_EXPIRY_MS;
            }));
        };
        clearExpiredCart();
        const interval = window.setInterval(clearExpiredCart, 60 * 1000);
        return () => window.clearInterval(interval);
    }, [cartReady]);

    const login = (mobile: string, name: string, type: UserType, data: Partial<Pick<User, 'id' | 'email' | 'avatarUrl'>> = {}) => {
        const newUser: User = {
            id: data.id || '',
            mobile, name, type,
            ...data,
            xerCoins: 0,
        };
        setUser(newUser);
        setAuthInitialized(true);
        setIsLoading(false);
        try { localStorage.setItem('xer_user', JSON.stringify(newUser)); } catch { }
    };

    const logout = async () => {
        try {
            await supabase.auth.signOut();
        } catch (err) {
            console.error('[AppContext] Supabase signOut error:', err);
        }
        setUser(null);
        setAuthInitialized(true);
        setIsLoading(false);
        try { localStorage.removeItem('xer_user'); } catch { }
        setCurrentOrder({ ...defaultOrder, files: [] });
        setLastOrderId('');
        setCart([]);
    };

    const updateProfile = async (data: Partial<User>) => {
        if (!user) return;

        // Prepare Supabase update payload (strictly allow only full_name, avatar_url - phone requires verification)
        const payload: { full_name?: string; avatar_url?: string } = {};
        if (data.name !== undefined) payload.full_name = data.name;
        if (data.avatarUrl !== undefined) payload.avatar_url = data.avatarUrl;

        if (user.id && Object.keys(payload).length > 0) {
            const { error } = await supabase
                .from('profiles')
                .update(payload)
                .eq('user_id', user.id);

            if (error) {
                console.error('[AppContext] Failed to update profile in Supabase:', error);
                throw new Error(error.message || 'Failed to update profile');
            }
        }

        if (data.email && data.email !== user.email) {
            const { error } = await supabase.auth.updateUser({ email: data.email.trim() });
            if (error) throw new Error(error.message);
            notify('Check your inbox to confirm your new email address.');
        }
        // Identity fields can only change through verified authentication flows.
        const { mobile: _ignoredMobile, email: _ignoredEmail, id: _ignoredId, type: _ignoredRole, xerCoins: _ignoredBalance, ...allowedData } = data;
        const updated = { ...user, ...allowedData };
        setUser(updated);
        try { localStorage.setItem('xer_user', JSON.stringify(updated)); } catch { }
    };

    const addXerCoins = (amount: number) => {
        if (!user || !Number.isFinite(amount) || amount <= 0) return false;
        const updated = { ...user, xerCoins: Math.round((user.xerCoins + amount) * 100) / 100 };
        setUser(updated);
        localStorage.setItem('xer_user', JSON.stringify(updated));
        return true;
    };

    const setXerCoinsBalance = useCallback((balance: number) => {
        if (!Number.isFinite(balance) || balance < 0) return false;
        setUser(prev => {
            if (!prev) return null;
            const rounded = Math.round(balance * 100) / 100;
            if (prev.xerCoins === rounded) return prev;
            const updated = { ...prev, xerCoins: rounded };
            try { localStorage.setItem('xer_user', JSON.stringify(updated)); } catch { }
            return updated;
        });
        return true;
    }, []);

    const addOrder = (order: Order) => {
        setOrders(prev => [order, ...prev]);
    };

    const addToCart = (item: Omit<CartItem, 'createdAt'> & Partial<Pick<CartItem, 'createdAt'>>) => {
        setCart(previous => {
            const existing = item.orderId ? previous.find(entry => entry.orderId === item.orderId) : undefined;
            const next = { ...item, createdAt: existing?.createdAt || item.createdAt || new Date().toISOString(), source: item.source || 'upload' as const };
            return existing ? previous.map(entry => entry.orderId === item.orderId ? next : entry) : [...previous, next];
        });
    };
    const removeFromCart = (idx: number) => setCart(prev => prev.filter((_, i) => i !== idx));

    return (
        <AppContext.Provider value={{
            user, isLoggedIn: authInitialized && !!user, authInitialized, isAuthLoading: !authInitialized, login, logout,
            orders, addOrder, currentOrder, setCurrentOrder,
            lastOrderId, setLastOrderId,
            cart, addToCart, removeFromCart, isLoading,
            theme, toggleTheme, updateProfile, addXerCoins, setXerCoinsBalance,
            refreshProfile,
            refreshOrders: fetchCustomerOrders,
            refreshWallet,
        }}>
            {children}
        </AppContext.Provider>
    );
}

export function useApp() {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useApp must be used within AppProvider');
    return ctx;
}
