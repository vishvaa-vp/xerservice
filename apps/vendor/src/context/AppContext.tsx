'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/lib/supabase/client';

export type UserType = 'customer' | 'vendor' | 'admin';

export interface User {
    id: string;
    mobile: string;
    email?: string;
    name: string;
    avatarUrl?: string;
    type: UserType;
    xerCoins: number;
}

interface CartItem {
    orderId?: string;
    orderNumber?: string;
    shopId: string;
    shopName: string;
    fileName: string;
    pages: number;
    color: boolean;
    sides: string;
    orientation: string;
    copies: number;
    totalAmount: number;
    createdAt: string;
}

interface OrderState {
    shopId: string;
    shopName: string;
    file: File | null;
    files: File[];
    totalFiles: number;
    totalEstimatedPages: number;
    fileName: string;
    pages: number;
    color: boolean;
    sides: string;
    orientation: string;
    copies: number;
    method: 'instant' | 'scheduled';
    scheduledTime: string;
    uploadedAt: string;
    totalAmount: number;
    paymentMethod: 'upi' | 'card' | 'wallet';
    documents?: any[];
}

interface AppContextType {
    user: User | null;
    isLoggedIn: boolean;
    authInitialized: boolean;
    isAuthLoading: boolean;
    isLoading: boolean;
    login: (mobile: string, name: string, type: UserType, data?: Partial<Pick<User, 'id' | 'email' | 'avatarUrl'>>) => void;
    logout: () => Promise<void>;
    orders: any[];
    addOrder: (order: any) => void;
    currentOrder: OrderState;
    setCurrentOrder: React.Dispatch<React.SetStateAction<OrderState>>;
    lastOrderId: string;
    setLastOrderId: (id: string) => void;
    cart: CartItem[];
    addToCart: (item: any) => void;
    removeFromCart: (idx: number) => void;
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
    shopId: '',
    shopName: '',
    file: null,
    files: [],
    totalFiles: 0,
    totalEstimatedPages: 0,
    fileName: '',
    pages: 1,
    color: false,
    sides: 'single',
    orientation: 'portrait',
    copies: 1,
    method: 'instant',
    scheduledTime: '',
    uploadedAt: '',
    totalAmount: 0,
    paymentMethod: 'upi',
};

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [orders, setOrders] = useState<any[]>([]);
    const [currentOrder, setCurrentOrder] = useState<OrderState>(defaultOrder);
    const [lastOrderId, setLastOrderId] = useState('');
    const [cart, setCart] = useState<CartItem[]>([]);
    const [authInitialized, setAuthInitialized] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [themeReady, setThemeReady] = useState(false);

    useEffect(() => {
        setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
        setThemeReady(true);
    }, []);

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

            const role = (profile?.role as UserType) || 'vendor';
            const name = profile?.full_name || authUser?.user_metadata?.full_name || (authUser?.email ? authUser.email.split('@')[0] : '') || 'Vendor';
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
            };
        } catch (err) {
            console.error('[AppContext] Failed to load profile:', err);
            return {
                id: userId,
                name: authUser?.user_metadata?.full_name || (authUser?.email ? authUser.email.split('@')[0] : '') || 'Vendor',
                email: authUser?.email || '',
                mobile: authUser?.phone || '',
                avatarUrl: authUser?.user_metadata?.avatar_url || '',
                type: 'vendor',
                xerCoins: 0,
            };
        }
    };

    const refreshProfile = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            const loaded = await fetchProfile(session.user.id, session.user);
            setUser(loaded);
            try { localStorage.setItem('xer_user', JSON.stringify(loaded)); } catch { }
        } else {
            setUser(null);
            try { localStorage.removeItem('xer_user'); } catch { }
        }
    }, []);

    useEffect(() => {
        let mounted = true;

        async function restoreSession() {
            try {
                const { data: { session }, error } = await supabase.auth.getSession();
                if (error) {
                    console.warn('[AppContext] Supabase getSession error:', error.message);
                }

                if (session?.user && mounted) {
                    const loaded = await fetchProfile(session.user.id, session.user);
                    if (mounted) {
                        setUser(loaded);
                        setAuthInitialized(true);
                        setIsLoading(false);
                        try { localStorage.setItem('xer_user', JSON.stringify(loaded)); } catch { }
                    }
                } else if (mounted) {
                    setUser(null);
                    setAuthInitialized(true);
                    setIsLoading(false);
                    try { localStorage.removeItem('xer_user'); } catch { }
                }
            } catch (err) {
                console.error('[AppContext] Failed to restore session:', err);
                if (mounted) {
                    setUser(null);
                    setAuthInitialized(true);
                    setIsLoading(false);
                }
            }
        }

        restoreSession();

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (!mounted) return;

            if (event === 'SIGNED_IN' && session?.user) {
                const loaded = await fetchProfile(session.user.id, session.user);
                if (mounted) {
                    setUser(loaded);
                    setAuthInitialized(true);
                    setIsLoading(false);
                    try { localStorage.setItem('xer_user', JSON.stringify(loaded)); } catch { }
                }
            } else if (event === 'SIGNED_OUT') {
                if (mounted) {
                    setUser(null);
                    setAuthInitialized(true);
                    setIsLoading(false);
                    try { localStorage.removeItem('xer_user'); } catch { }
                }
            }
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, []);

    const login = (mobile: string, name: string, type: UserType, data?: Partial<Pick<User, 'id' | 'email' | 'avatarUrl'>>) => {
        const u: User = {
            id: data?.id || `user_${Date.now()}`,
            mobile,
            name,
            email: data?.email,
            avatarUrl: data?.avatarUrl,
            type,
            xerCoins: 0,
        };
        setUser(u);
        try { localStorage.setItem('xer_user', JSON.stringify(u)); } catch { }
    };

    const logout = useCallback(async () => {
        try {
            await supabase.auth.signOut();
        } catch (err) {
            console.error('[AppContext] Supabase signOut error:', err);
        }
        setUser(null);
        try { localStorage.removeItem('xer_user'); } catch { }
        if (typeof window !== 'undefined') {
            window.location.href = '/vendor/login';
        }
    }, []);

    const addOrder = (order: any) => {
        setOrders(prev => [order, ...prev]);
    };

    const addToCart = (item: any) => {
        setCart(prev => [item, ...prev]);
    };

    const removeFromCart = (idx: number) => {
        setCart(prev => prev.filter((_, i) => i !== idx));
    };

    const updateProfile = async (data: Partial<User>) => {
        setUser(prev => prev ? { ...prev, ...data } : null);
    };

    const addXerCoins = () => true;
    const setXerCoinsBalance = () => true;
    const refreshOrders = async () => {};
    const refreshWallet = async () => {};

    return (
        <AppContext.Provider value={{
            user,
            isLoggedIn: !!user,
            authInitialized,
            isAuthLoading: isLoading,
            isLoading,
            login,
            logout,
            orders,
            addOrder,
            currentOrder,
            setCurrentOrder,
            lastOrderId,
            setLastOrderId,
            cart,
            addToCart,
            removeFromCart,
            theme,
            toggleTheme,
            updateProfile,
            addXerCoins,
            setXerCoinsBalance,
            refreshProfile,
            refreshOrders,
            refreshWallet,
        }}>
            {children}
        </AppContext.Provider>
    );
}

export function useApp() {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useApp must be used within an AppProvider');
    }
    return context;
}
