'use client';

type ActivityMap = Record<string, number>;

const WEEKS = 30;
const DAYS_PER_WEEK = 7;

const formatDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const cloneDate = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export default function LoginActivityHeatmap({
    activity,
    streak,
    totalActiveDays,
    title = 'Login Activity',
}: {
    activity: ActivityMap;
    streak: number;
    totalActiveDays: number;
    title?: string;
}) {
    const today = cloneDate(new Date());
    const totalDays = WEEKS * DAYS_PER_WEEK;
    const start = cloneDate(today);
    start.setDate(start.getDate() - (totalDays - 1));

    const days = Array.from({ length: totalDays }).map((_, idx) => {
        const d = cloneDate(start);
        d.setDate(start.getDate() + idx);
        const key = formatDateKey(d);
        return { key, date: d, count: Math.max(0, Math.min(4, activity[key] || 0)) };
    });

    const weeks = Array.from({ length: WEEKS }).map((_, weekIdx) =>
        days.slice(weekIdx * DAYS_PER_WEEK, (weekIdx + 1) * DAYS_PER_WEEK)
    );

    const monthLabels = weeks.map((week) => {
        const firstDay = week[0].date;
        const month = firstDay.toLocaleString('en-US', { month: 'short' });
        const weekIndex = firstDay.getDate();
        return weekIndex <= 7 ? month : '';
    });

    const getColor = (count: number) => {
        if (count >= 4) return '#166534';
        if (count === 3) return '#16a34a';
        if (count === 2) return '#4ade80';
        if (count === 1) return '#86efac';
        return 'var(--bg-tertiary)';
    };

    return (
        <div className="card" style={{ padding: '28px', borderRadius: '20px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '14px', flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '800' }}>{title}</h3>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--fg-muted)', background: 'var(--bg-secondary)', borderRadius: '999px', padding: '5px 10px' }}>
                        Streak: {streak} day{streak === 1 ? '' : 's'}
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--fg-muted)', background: 'var(--bg-secondary)', borderRadius: '999px', padding: '5px 10px' }}>
                        Active Days: {totalActiveDays}
                    </div>
                </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: '760px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${WEEKS}, 1fr)`, gap: '4px', marginBottom: '8px', paddingLeft: '2px' }}>
                        {monthLabels.map((label, idx) => (
                            <div key={`m-${idx}`} style={{ fontSize: '10px', color: 'var(--fg-subtle)', minHeight: '12px' }}>
                                {label}
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${WEEKS}, 1fr)`, gap: '4px' }}>
                        {weeks.map((week, weekIdx) => (
                            <div key={`w-${weekIdx}`} style={{ display: 'grid', gridTemplateRows: `repeat(${DAYS_PER_WEEK}, 1fr)`, gap: '4px' }}>
                                {week.map((day) => (
                                    <div
                                        key={day.key}
                                        title={`${day.key}: ${day.count > 0 ? `${day.count} visits` : 'No activity'}`}
                                        style={{
                                            width: '100%',
                                            aspectRatio: '1',
                                            background: getColor(day.count),
                                            borderRadius: '2px',
                                            border: day.count > 0 ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid var(--border)',
                                            transition: 'transform 0.2s ease',
                                        }}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', fontSize: '11px', color: 'var(--fg-subtle)', fontWeight: '700' }}>
                <span>Less</span>
                {[0, 1, 2, 3, 4].map((level) => (
                    <span key={level} style={{ width: '12px', height: '12px', borderRadius: '2px', background: getColor(level), border: '1px solid var(--border)' }} />
                ))}
                <span>More</span>
            </div>
        </div>
    );
}
