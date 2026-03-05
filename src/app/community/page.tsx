'use client';

import { useState } from 'react';
import { mockForumPosts, ForumPost } from '@/lib/mock-data';
import { useApp } from '@/context/AppContext';
import { useRouter } from 'next/navigation';
import {
    Lightbulb,
    Bug,
    MessageCircle,
    ChevronUp,
    MessageSquare,
    Plus,
    ArrowRight,
    TrendingUp,
} from 'lucide-react';

function CategoryIcon({ category, size = 16 }: { category: string; size?: number }) {
    if (category === 'feature') return <Lightbulb size={size} />;
    if (category === 'problem') return <Bug size={size} />;
    return <MessageCircle size={size} />;
}

export default function CommunityPage() {
    const { user } = useApp();
    const router = useRouter();
    const [posts, setPosts] = useState(mockForumPosts);
    const [activeCategory, setActiveCategory] = useState<'all' | 'feature' | 'problem' | 'general'>('all');
    const [expandedPost, setExpandedPost] = useState<string | null>(null);
    const [newComment, setNewComment] = useState<Record<string, string>>({});
    const [composing, setComposing] = useState(false);
    const [newPost, setNewPost] = useState({ title: '', body: '', category: 'general' as 'feature' | 'problem' | 'general' });
    const [authNotice, setAuthNotice] = useState<string | null>(null);

    const requireLogin = (action: string) => {
        if (user) return true;
        const ok = window.confirm(`Please log in to ${action}. Go to login now?`);
        if (ok) router.push('/login?redirect=/community');
        else setAuthNotice(`Log in required to ${action}.`);
        return false;
    };

    const filtered = activeCategory === 'all' ? posts : posts.filter(p => p.category === activeCategory);

    const handleUpvote = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!requireLogin('upvote')) return;
        setPosts(prev => prev.map(p => p.id === id ? { ...p, upvotes: p.upvotes + 1 } : p));
    };

    const handleComment = (postId: string) => {
        if (!requireLogin('comment')) return;
        const text = newComment[postId];
        if (!text?.trim()) return;
        setPosts(prev => prev.map(p => p.id === postId ? {
            ...p,
            comments: [...p.comments, { id: Date.now().toString(), author: user!.name, body: text, createdAt: new Date().toISOString() }]
        } : p));
        setNewComment(prev => ({ ...prev, [postId]: '' }));
    };

    const handleNewPost = () => {
        if (!requireLogin('create a discussion')) return;
        if (!newPost.title.trim() || !newPost.body.trim()) return;
        const post: ForumPost = {
            id: Date.now().toString(),
            author: user!.name,
            category: newPost.category,
            title: newPost.title,
            body: newPost.body,
            upvotes: 0,
            comments: [],
            createdAt: new Date().toISOString(),
        };
        setPosts(prev => [post, ...prev]);
        setNewPost({ title: '', body: '', category: 'general' });
        setComposing(false);
    };

    return (
        <div className="page-wrapper pb-32">
            {/* Hero Section */}
            <section className="hero-gradient" style={{ padding: '80px 0 60px' }}>
                <div className="container">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '24px' }}>
                        <div style={{ maxWidth: '600px' }}>
                            <div className="badge badge-accent mb-4">TAMIL NADU COMMUNITY</div>
                            <h1 style={{ fontSize: '48px', fontWeight: '900', letterSpacing: '-0.05em', lineHeight: '1.1', marginBottom: '16px' }}>Digital <span className="gradient-text">Forum.</span></h1>
                            <p style={{ fontSize: '18px', color: 'var(--fg-muted)', lineHeight: '1.6' }}>Shape the future of XerService by suggesting features, reporting issues, or sharing your print success stories.</p>
                            {authNotice && <p style={{ marginTop: '10px', fontSize: '13px', color: '#b45309', fontWeight: '700' }}>{authNotice}</p>}
                        </div>
                        <button onClick={() => { if (requireLogin('create a discussion')) setComposing(true); }} className="btn btn-accent btn-lg" style={{ height: '56px', padding: '0 32px', borderRadius: '16px', fontWeight: '800' }}>
                            <Plus size={20} /> Create Discussion
                        </button>
                    </div>
                </div>
            </section>

            <section className="pt-12">
                <div className="container">
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: '48px', alignItems: 'start' }}>
                        {/* Main Feed */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                            {/* Filter bar */}
                            <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '20px', overflowX: 'auto', paddingLeft: '4px', paddingRight: '4px' }}>
                                {(['all', 'feature', 'problem', 'general'] as const).map(cat => (
                                    <button key={cat} onClick={() => setActiveCategory(cat)}
                                        style={{
                                            padding: '10px 20px',
                                            borderRadius: '100px',
                                            fontSize: '14px',
                                            fontWeight: '700',
                                            whiteSpace: 'nowrap',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                            border: 'none',
                                            background: activeCategory === cat ? 'var(--fg)' : 'var(--bg-secondary)',
                                            color: activeCategory === cat ? 'var(--bg)' : 'var(--fg-muted)'
                                        }}>
                                        {cat === 'all' ? 'Everything' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                                    </button>
                                ))}
                            </div>

                            {/* Post list */}
                            {filtered.map(post => (
                                <div key={post.id} className="card card-hover" onClick={() => setExpandedPost(expandedPost === post.id ? null : post.id)}
                                    style={{ padding: '0', overflow: 'hidden', border: '1.5px solid var(--border)', cursor: 'pointer', transition: 'transform 0.2s' }}>
                                    <div style={{ padding: '32px' }}>
                                        <div style={{ display: 'flex', gap: '24px' }}>
                                            {/* Vote Column */}
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                                <button onClick={(e) => handleUpvote(post.id, e)} className="btn-icon" style={{ width: '44px', height: '44px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                                                    <ChevronUp size={20} />
                                                </button>
                                                <span style={{ fontSize: '16px', fontWeight: '900', color: post.upvotes > 20 ? 'var(--accent)' : 'var(--fg)' }}>{post.upvotes}</span>
                                            </div>

                                            {/* Content Column */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--accent)' }}>
                                                        <CategoryIcon category={post.category} size={14} /> {post.category}
                                                    </div>
                                                    <span style={{ width: '4px', height: '4px', background: 'var(--border)', borderRadius: '50%' }} />
                                                    <span style={{ fontSize: '12px', color: 'var(--fg-subtle)', fontWeight: '600' }}>{new Date(post.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                                                </div>

                                                <h3 style={{ fontSize: '22px', fontWeight: '900', letterSpacing: '-0.03em', marginBottom: '12px', lineHeight: '1.3' }}>{post.title}</h3>
                                                <p style={{ fontSize: '15px', color: 'var(--fg-muted)', lineHeight: '1.7', marginBottom: '24px' }}>{post.body}</p>

                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <div style={{ width: '36px', height: '36px', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '900', fontSize: '14px' }}>
                                                            {post.author[0]}
                                                        </div>
                                                        <div>
                                                            <div style={{ fontSize: '14px', fontWeight: '800' }}>{post.author}</div>
                                                            <div style={{ fontSize: '11px', color: 'var(--fg-subtle)', fontWeight: '700' }}>Community Member</div>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--fg-subtle)', fontSize: '13px', fontWeight: '700' }}>
                                                        <MessageSquare size={16} /> {post.comments.length}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Comments Drawer */}
                                    {expandedPost === post.id && (
                                        <div style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', padding: '32px' }} onClick={e => e.stopPropagation()}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                                                {post.comments.map(c => (
                                                    <div key={c.id} style={{ display: 'flex', gap: '12px' }}>
                                                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '12px', fontWeight: '800' }}>
                                                            {c.author[0]}
                                                        </div>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '4px' }}>
                                                                <span style={{ fontSize: '13px', fontWeight: '800' }}>{c.author}</span>
                                                                <span style={{ fontSize: '11px', color: 'var(--fg-subtle)' }}>• Just now</span>
                                                            </div>
                                                            <p style={{ fontSize: '14px', color: 'var(--fg-muted)', lineHeight: '1.6' }}>{c.body}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            {user ? (
                                                <div style={{ display: 'flex', gap: '12px' }}>
                                                    <input className="input" placeholder="Type your reply..." value={newComment[post.id] || ''}
                                                        onChange={e => setNewComment(prev => ({ ...prev, [post.id]: e.target.value }))}
                                                        style={{ height: '44px', borderRadius: '12px', background: 'var(--bg)', border: '1.5px solid var(--border)' }} />
                                                    <button onClick={() => handleComment(post.id)} className="btn btn-accent" style={{ padding: '0 24px', borderRadius: '12px' }}>Reply</button>
                                                </div>
                                            ) : (
                                                <button onClick={() => requireLogin('comment')} className="btn btn-outline" style={{ borderRadius: '12px' }}>Log in to comment</button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Sidebar */}
                        <aside style={{ display: 'flex', flexDirection: 'column', gap: '32px', position: 'sticky', top: '100px' }}>
                            {/* Guidelines */}
                            <div className="card" style={{ padding: '32px', border: '1.5px solid var(--border)' }}>
                                <h3 style={{ fontSize: '18px', fontWeight: '900', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <MessageSquare size={20} color="var(--accent)" /> Community Guidelines
                                </h3>
                                <p style={{ fontSize: '13px', color: 'var(--fg-muted)', marginBottom: '12px', lineHeight: '1.6' }}>Keep the forum clear and useful for everyone.</p>
                                <ul style={{ paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--fg-muted)', fontSize: '13px' }}>
                                    <li>Use clear titles with exact issue/feature details.</li>
                                    <li>Avoid sharing personal phone numbers in posts.</li>
                                    <li>Upvote useful responses to help others quickly.</li>
                                </ul>
                            </div>

                            {/* Popular tags */}
                            <div className="card" style={{ padding: '32px', border: '1.5px solid var(--border)' }}>
                                <h3 style={{ fontSize: '16px', fontWeight: '900', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <TrendingUp size={18} /> Trending Topics
                                </h3>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {['#rs_puram', '#bulk_printing', '#color_calib', '#resume_hacks', '#xer_service_pro'].map(tag => (
                                        <div key={tag} style={{ background: 'var(--bg-secondary)', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', color: 'var(--fg-muted)', cursor: 'pointer' }}>
                                            {tag}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </aside>
                    </div>
                </div>
            </section>

            {/* Compose Modal */}
            {composing && (
                <div className="overlay">
                    <div className="modal" style={{ maxWidth: '640px', padding: '48px', borderRadius: '32px' }}>
                        <h2 style={{ fontSize: '32px', fontWeight: '900', letterSpacing: '-0.04em', marginBottom: '8px' }}>Start a Discussion</h2>
                        <p style={{ fontSize: '16px', color: 'var(--fg-muted)', marginBottom: '40px' }}>What's happening in the Coimbatore printing scene?</p>

                        <div style={{ display: 'flex', gap: '12px', marginBottom: '32px' }}>
                            {(['feature', 'problem', 'general'] as const).map(cat => (
                                <button key={cat} onClick={() => setNewPost(p => ({ ...p, category: cat }))}
                                    style={{
                                        flex: 1,
                                        padding: '16px',
                                        borderRadius: '16px',
                                        border: `2.5px solid ${newPost.category === cat ? 'var(--accent)' : 'var(--border)'}`,
                                        background: 'transparent',
                                        color: newPost.category === cat ? 'var(--accent)' : 'var(--fg-muted)',
                                        fontWeight: '800',
                                        fontSize: '14px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '12px',
                                        transition: 'all 0.2s'
                                    }}>
                                    <CategoryIcon category={cat} size={24} />
                                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                                </button>
                            ))}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <div>
                                <label className="input-label">Discussion Title</label>
                                <input className="input" placeholder="Give it a punchy title..." value={newPost.title} onChange={e => setNewPost(p => ({ ...p, title: e.target.value }))} style={{ height: '56px', borderRadius: '14px', fontSize: '16px', fontWeight: '700' }} />
                            </div>
                            <div>
                                <label className="input-label">Details</label>
                                <textarea className="input" rows={6} placeholder="Describe your topic in detail..." value={newPost.body} onChange={e => setNewPost(p => ({ ...p, body: e.target.value }))} style={{ borderRadius: '14px', fontSize: '16px', padding: '20px', lineHeight: '1.6' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
                                <button onClick={handleNewPost} className="btn btn-accent btn-lg" style={{ flex: 1.5, borderRadius: '14px' }}>Publish Post <ArrowRight size={20} /></button>
                                <button onClick={() => setComposing(false)} className="btn btn-ghost btn-lg" style={{ flex: 1, borderRadius: '14px' }}>Discard</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
