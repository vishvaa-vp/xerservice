'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Order, mockOrders } from '@/lib/mock-data';

export type UserType = 'customer' | 'vendor' | 'admin';

export interface User {
    mobile: string;
    email?: string;
    name: string;
    avatarUrl?: string;
    type: UserType;
    xerCoins: number;
    badges: string[];
}

interface CartItem {
    shopId: string;
    shopName: string;
    fileName: string;
    pages: number;
    color: boolean;
    sides: 'single' | 'double' | 'double_long' | 'double_short';
    orientation: 'portrait' | 'landscape';
    copies: number;
    totalAmount: number;
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
    sides: 'single' | 'double' | 'double_long' | 'double_short';
    orientation: 'portrait' | 'landscape';
    copies: number;
    method: 'instant' | 'scheduled';
    scheduledTime: string;
    totalAmount: number;
    paymentMethod: 'upi' | 'card' | 'wallet';
}

interface AppContextType {
    user: User | null;
    isLoggedIn: boolean;
    login: (mobile: string, name: string, type: UserType) => void;
    logout: () => void;
    orders: Order[];
    addOrder: (order: Order) => void;
    currentOrder: OrderState;
    setCurrentOrder: React.Dispatch<React.SetStateAction<OrderState>>;
    lastOrderId: string;
    setLastOrderId: (id: string) => void;
    cart: CartItem[];
    addToCart: (item: CartItem) => void;
    removeFromCart: (idx: number) => void;
    isLoading: boolean;
    theme: 'light' | 'dark';
    toggleTheme: () => void;
    updateProfile: (data: Partial<User>) => void;
    addXerCoins: (amount: number) => boolean;
    setXerCoinsBalance: (balance: number) => boolean;
    activity: Record<string, number>;
    streak: number;
    totalActiveDays: number;
}

const defaultOrder: OrderState = {
    shopId: '', shopName: '', file: null, files: [], totalFiles: 0, totalEstimatedPages: 0, fileName: '',
    pages: 1, color: false, sides: 'single', orientation: 'portrait',
    copies: 1, method: 'instant', scheduledTime: '', totalAmount: 0,
    paymentMethod: 'upi',
};

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [orders, setOrders] = useState<Order[]>(mockOrders);
    const [currentOrder, setCurrentOrder] = useState<OrderState>(defaultOrder);
    const [lastOrderId, setLastOrderId] = useState('');
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [activity, setActivity] = useState<Record<string, number>>({});

    const dateKey = (date: Date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const activityStorageKey = (mobile: string) => `xer_activity_${mobile}`;

    const loadActivity = useCallback((mobile: string): Record<string, number> => {
        try {
            const raw = localStorage.getItem(activityStorageKey(mobile));
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return {};
            const clean: Record<string, number> = {};
            Object.entries(parsed).forEach(([k, v]) => {
                const count = Number(v);
                if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(count) && count > 0) {
                    clean[k] = Math.min(4, Math.max(1, Math.round(count)));
                }
            });
            return clean;
        } catch {
            return {};
        }
    }, []);

    const computeStreak = (map: Record<string, number>): number => {
        let streakDays = 0;
        const cursor = new Date();
        while (true) {
            const key = dateKey(cursor);
            if (!map[key]) break;
            streakDays += 1;
            cursor.setDate(cursor.getDate() - 1);
        }
        return streakDays;
    };

    // Load theme
    useEffect(() => {
        const saved = localStorage.getItem('xer_theme');
        if (saved === 'dark') setTheme('dark');
        else if (saved === 'light') setTheme('light');
        else if (window.matchMedia('(prefers-color-scheme: dark)').matches) setTheme('dark');
    }, []);

    // Apply theme
    useEffect(() => {
        if (theme === 'dark') document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
        localStorage.setItem('xer_theme', theme);
    }, [theme]);

    const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

    // Simulate loading screen
    useEffect(() => {
        const timer = setTimeout(() => setIsLoading(false), 2000);
        return () => clearTimeout(timer);
    }, []);

    // Restore session
    useEffect(() => {
        try {
            const saved = localStorage.getItem('xer_user');
            if (saved) setUser(JSON.parse(saved));
        } catch { }
    }, []);

    useEffect(() => {
        if (!user?.mobile) {
            setActivity({});
            return;
        }
        const current = loadActivity(user.mobile);
        const today = dateKey(new Date());
        const next = { ...current, [today]: Math.min(4, (current[today] || 0) + 1) };
        localStorage.setItem(activityStorageKey(user.mobile), JSON.stringify(next));
        setActivity(next);
    }, [user?.mobile, loadActivity]);

    const login = (mobile: string, name: string, type: UserType) => {
        const newUser: User = {
            mobile, name, type,
            xerCoins: type === 'customer' ? 250 : 0,
            badges: type === 'customer' ? ['contributor'] : [],
        };
        setUser(newUser);
        localStorage.setItem('xer_user', JSON.stringify(newUser));
    };

    const logout = () => {
        setUser(null);
        localStorage.removeItem('xer_user');
        setCurrentOrder({ ...defaultOrder, files: [] });
        setLastOrderId('');
        setCart([]);
        setActivity({});
    };

    const updateProfile = (data: Partial<User>) => {
        if (!user) return;
        const updated = { ...user, ...data };
        setUser(updated);
        localStorage.setItem('xer_user', JSON.stringify(updated));
    };

    const addXerCoins = (amount: number) => {
        if (!user || !Number.isFinite(amount) || amount <= 0) return false;
        const updated = { ...user, xerCoins: Math.round((user.xerCoins + amount) * 100) / 100 };
        setUser(updated);
        localStorage.setItem('xer_user', JSON.stringify(updated));
        return true;
    };

    const setXerCoinsBalance = (balance: number) => {
        if (!user || !Number.isFinite(balance) || balance < 0) return false;
        const updated = { ...user, xerCoins: Math.round(balance * 100) / 100 };
        setUser(updated);
        localStorage.setItem('xer_user', JSON.stringify(updated));
        return true;
    };

    const addOrder = (order: Order) => {
        setOrders(prev => [order, ...prev]);
        // Deduct XerCoins if paid with wallet
        if (order.paymentMethod === 'wallet' && user) {
            const nextBalance = Math.max(0, Math.round((user.xerCoins - order.totalAmount) * 100) / 100);
            const updated = { ...user, xerCoins: nextBalance };
            setUser(updated);
            localStorage.setItem('xer_user', JSON.stringify(updated));
        }
    };

    const addToCart = (item: CartItem) => setCart(prev => [...prev, item]);
    const removeFromCart = (idx: number) => setCart(prev => prev.filter((_, i) => i !== idx));
    const streak = computeStreak(activity);
    const totalActiveDays = Object.keys(activity).length;

    return (
        <AppContext.Provider value={{
            user, isLoggedIn: !!user, login, logout,
            orders, addOrder, currentOrder, setCurrentOrder,
            lastOrderId, setLastOrderId,
            cart, addToCart, removeFromCart, isLoading,
            theme, toggleTheme, updateProfile, addXerCoins, setXerCoinsBalance,
            activity, streak, totalActiveDays,
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
