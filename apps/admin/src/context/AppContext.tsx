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
}

interface AppContextType {
    user: User | null;
    isLoggedIn: boolean;
    authInitialized: boolean;
    isAuthLoading: boolean;
    isLoading: boolean;
    logout: () => Promise<void>;
    theme: 'light' | 'dark';
    toggleTheme: () => void;
    updateProfile: (data: Partial<User>) => Promise<void> | void;
    refreshProfile: () => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
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

    const fetchProfile = async (userId: string, authUser?: any): Promise<User | null> => {
        try {
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('id, user_id, full_name, phone, avatar_url, role')
                .eq('user_id', userId)
                .maybeSingle();

            if (error) {
                console.warn('[AppContext] Supabase profile fetch error:', error.message);
            }

            const role = (profile?.role as UserType) || 'admin';
            const name = profile?.full_name || authUser?.user_metadata?.full_name || (authUser?.email ? authUser.email.split('@')[0] : '') || 'Admin';
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
            };
        } catch (err) {
            console.error('[AppContext] Failed to load admin profile:', err);
            return {
                id: userId,
                name: authUser?.user_metadata?.full_name || (authUser?.email ? authUser.email.split('@')[0] : '') || 'Admin',
                email: authUser?.email || '',
                mobile: authUser?.phone || '',
                avatarUrl: authUser?.user_metadata?.avatar_url || '',
                type: 'admin',
            };
        }
    };

    const refreshProfile = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            const loaded = await fetchProfile(session.user.id, session.user);
            setUser(loaded);
        } else {
            setUser(null);
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
                    }
                } else if (mounted) {
                    setUser(null);
                    setAuthInitialized(true);
                    setIsLoading(false);
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
                }
            } else if (event === 'SIGNED_OUT') {
                if (mounted) {
                    setUser(null);
                    setAuthInitialized(true);
                    setIsLoading(false);
                }
            }
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, []);

    const logout = useCallback(async () => {
        try {
            await supabase.auth.signOut();
        } catch (err) {
            console.error('[AppContext] Supabase signOut error:', err);
        }
        setUser(null);
        if (typeof window !== 'undefined') {
            window.location.href = '/xad/login';
        }
    }, []);

    const updateProfile = async (data: Partial<User>) => {
        setUser(prev => prev ? { ...prev, ...data } : null);
    };

    return (
        <AppContext.Provider value={{
            user,
            isLoggedIn: !!user,
            authInitialized,
            isAuthLoading: isLoading,
            isLoading,
            logout,
            theme,
            toggleTheme,
            updateProfile,
            refreshProfile,
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
