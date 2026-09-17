/**
 * XerService Backend — Stage A6: Earnings Calculation Math & CSV Formatter
 * Pure mathematical, date boundary, and CSV formatting logic.
 * Zero external database or network dependencies.
 */

export type DatePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'this_year' | 'all_time' | 'custom';

export interface DateRange {
    preset: DatePreset;
    startUtc: string;
    endUtc: string;
    prevStartUtc: string;
    prevEndUtc: string;
    label: string;
}

export interface MetricWithComparison {
    current: number;
    previous: number;
    delta: number;
    percentChange: number | null; // null if previous is 0
}

export interface RefundBreakdownState {
    count: number;
    totalAmount: number;
}

export interface RefundBreakdown {
    unpaidCancellations: RefundBreakdownState;
    paidCancellationsAwaitingRefund: RefundBreakdownState;
    confirmedRefunds: RefundBreakdownState;
    failedPendingRefunds: RefundBreakdownState;
}

export interface ShopEarningsBreakdown {
    shopId: string;
    shopName: string;
    ordersCount: number;
    serviceRevenue: number;
    xerServiceEarnings: number;
    shopEarnings: number;
    confirmedRefunds: number;
    cancellationsCount: number;
    unallocatedCount: number;
    unallocatedAmount: number;
    settledAmount: number;
}

export interface AuthoritativeEarningsReport {
    period: DateRange;
    kpis: {
        xerServiceEarnings: MetricWithComparison;
        serviceRevenue: MetricWithComparison;
        shopEarnings: MetricWithComparison;
        confirmedRefunds: MetricWithComparison;
        ordersIncluded: MetricWithComparison;
        settledDisbursements: MetricWithComparison;
    };
    refunds: RefundBreakdown;
    shops: ShopEarningsBreakdown[];
    metricSources: Record<string, {
        source: string;
        inclusion: string;
        timestampBasis: string;
        refundTreatment: string;
    }>;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Returns date range boundaries in UTC based on Asia/Kolkata (IST) calendar dates.
 */
export function getReportingDateRange(
    preset: DatePreset,
    customStart?: string | null,
    customEnd?: string | null,
    referenceNow: Date = new Date()
): DateRange {
    // Current IST time
    const istNow = new Date(referenceNow.getTime() + IST_OFFSET_MS);
    const y = istNow.getUTCFullYear();
    const m = istNow.getUTCMonth();
    const d = istNow.getUTCDate();
    const dayOfWeek = istNow.getUTCDay(); // 0 is Sunday, 1 is Monday

    let startIst: Date;
    let endIst: Date;
    let prevStartIst: Date;
    let prevEndIst: Date;
    let label = '';

    switch (preset) {
        case 'today': {
            label = 'Today';
            startIst = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
            endIst = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
            // Previous day
            prevStartIst = new Date(Date.UTC(y, m, d - 1, 0, 0, 0, 0));
            prevEndIst = new Date(Date.UTC(y, m, d - 1, 23, 59, 59, 999));
            break;
        }
        case 'yesterday': {
            label = 'Yesterday';
            startIst = new Date(Date.UTC(y, m, d - 1, 0, 0, 0, 0));
            endIst = new Date(Date.UTC(y, m, d - 1, 23, 59, 59, 999));
            // Day before yesterday
            prevStartIst = new Date(Date.UTC(y, m, d - 2, 0, 0, 0, 0));
            prevEndIst = new Date(Date.UTC(y, m, d - 2, 23, 59, 59, 999));
            break;
        }
        case 'this_week': {
            label = 'This Week';
            // Start of week (Monday)
            const diffToMonday = (dayOfWeek + 6) % 7;
            startIst = new Date(Date.UTC(y, m, d - diffToMonday, 0, 0, 0, 0));
            endIst = new Date(Date.UTC(y, m, d - diffToMonday + 6, 23, 59, 59, 999));
            // Previous week
            prevStartIst = new Date(Date.UTC(y, m, d - diffToMonday - 7, 0, 0, 0, 0));
            prevEndIst = new Date(Date.UTC(y, m, d - diffToMonday - 1, 23, 59, 59, 999));
            break;
        }
        case 'this_month': {
            label = 'This Month';
            startIst = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
            // Last day of this month
            endIst = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
            // Previous month
            prevStartIst = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
            prevEndIst = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
            break;
        }
        case 'this_year': {
            label = 'This Year';
            startIst = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
            endIst = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
            // Previous year
            prevStartIst = new Date(Date.UTC(y - 1, 0, 1, 0, 0, 0, 0));
            prevEndIst = new Date(Date.UTC(y - 1, 11, 31, 23, 59, 59, 999));
            break;
        }
        case 'custom': {
            label = 'Custom Period';
            if (customStart && customEnd) {
                const sDate = new Date(customStart);
                const eDate = new Date(customEnd);
                startIst = new Date(sDate.getTime() + IST_OFFSET_MS);
                endIst = new Date(eDate.getTime() + IST_OFFSET_MS);
            } else {
                startIst = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
                endIst = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
            }
            const durationMs = endIst.getTime() - startIst.getTime();
            prevEndIst = new Date(startIst.getTime() - 1);
            prevStartIst = new Date(prevEndIst.getTime() - durationMs);
            break;
        }
        case 'all_time':
        default: {
            label = 'All Time';
            startIst = new Date(Date.UTC(2020, 0, 1, 0, 0, 0, 0));
            endIst = new Date(Date.UTC(y + 1, 11, 31, 23, 59, 59, 999));
            prevStartIst = new Date(Date.UTC(2019, 0, 1, 0, 0, 0, 0));
            prevEndIst = new Date(Date.UTC(2019, 11, 31, 23, 59, 59, 999));
            break;
        }
    }

    // Convert back to UTC storage bounds
    const startUtc = new Date(startIst.getTime() - IST_OFFSET_MS).toISOString();
    const endUtc = new Date(endIst.getTime() - IST_OFFSET_MS).toISOString();
    const prevStartUtc = new Date(prevStartIst.getTime() - IST_OFFSET_MS).toISOString();
    const prevEndUtc = new Date(prevEndIst.getTime() - IST_OFFSET_MS).toISOString();

    return {
        preset,
        startUtc,
        endUtc,
        prevStartUtc,
        prevEndUtc,
        label,
    };
}

/**
 * Calculates delta and percentage change between current and previous values.
 */
export function calculatePeriodComparison(currentVal: number, previousVal: number): MetricWithComparison {
    const current = Math.round(currentVal * 100) / 100;
    const previous = Math.round(previousVal * 100) / 100;
    const delta = Math.round((current - previous) * 100) / 100;
    let percentChange: number | null = null;

    if (previous > 0) {
        percentChange = Math.round(((current - previous) / previous) * 1000) / 10;
    } else if (previous === 0 && current > 0) {
        percentChange = 100.0;
    } else if (previous === 0 && current === 0) {
        percentChange = 0.0;
    }

    return {
        current,
        previous,
        delta,
        percentChange,
    };
}

/**
 * Generates formatted CSV string matching database earnings totals exactly.
 */
export function generateEarningsCsv(report: AuthoritativeEarningsReport): string {
    const lines: string[] = [];

    // Header metadata
    lines.push(`"XerService Platform Earnings Report"`);
    lines.push(`"Period:","${report.period.label} (${report.period.startUtc} to ${report.period.endUtc}) [Asia/Kolkata]"`);
    lines.push(`"Generated At:","${new Date().toISOString()}"`);
    lines.push('');

    // Summary KPIs
    lines.push('"Summary KPIs"');
    lines.push('"Metric","Current (₹)","Previous Period (₹)","Delta (₹)","% Change"');
    lines.push(`"XerService Earnings",${report.kpis.xerServiceEarnings.current},${report.kpis.xerServiceEarnings.previous},${report.kpis.xerServiceEarnings.delta},"${report.kpis.xerServiceEarnings.percentChange ?? 0}%"`);
    lines.push(`"Service Revenue",${report.kpis.serviceRevenue.current},${report.kpis.serviceRevenue.previous},${report.kpis.serviceRevenue.delta},"${report.kpis.serviceRevenue.percentChange ?? 0}%"`);
    lines.push(`"Shop Earnings",${report.kpis.shopEarnings.current},${report.kpis.shopEarnings.previous},${report.kpis.shopEarnings.delta},"${report.kpis.shopEarnings.percentChange ?? 0}%"`);
    lines.push(`"Confirmed Refunds",${report.kpis.confirmedRefunds.current},${report.kpis.confirmedRefunds.previous},${report.kpis.confirmedRefunds.delta},"${report.kpis.confirmedRefunds.percentChange ?? 0}%"`);
    lines.push(`"Orders Included",${report.kpis.ordersIncluded.current},${report.kpis.ordersIncluded.previous},${report.kpis.ordersIncluded.delta},"${report.kpis.ordersIncluded.percentChange ?? 0}%"`);
    lines.push(`"Settled Disbursements",${report.kpis.settledDisbursements.current},${report.kpis.settledDisbursements.previous},${report.kpis.settledDisbursements.delta},"${report.kpis.settledDisbursements.percentChange ?? 0}%"`);
    lines.push('');

    // Section 9.2 Refunds & Cancellations
    lines.push('"Refunds and Cancellations Breakdown"');
    lines.push('"Category","Count","Total Amount (₹)"');
    lines.push(`"Unpaid Cancellations",${report.refunds.unpaidCancellations.count},${report.refunds.unpaidCancellations.totalAmount}`);
    lines.push(`"Paid Cancellations Awaiting Refund",${report.refunds.paidCancellationsAwaitingRefund.count},${report.refunds.paidCancellationsAwaitingRefund.totalAmount}`);
    lines.push(`"Confirmed Refunds",${report.refunds.confirmedRefunds.count},${report.refunds.confirmedRefunds.totalAmount}`);
    lines.push(`"Failed / Pending Refunds",${report.refunds.failedPendingRefunds.count},${report.refunds.failedPendingRefunds.totalAmount}`);
    lines.push('');

    // Shop Totals Breakdown
    lines.push('"Shop-by-Shop Totals Breakdown"');
    lines.push('"Shop Name","Orders","Service Revenue (₹)","XerService Fee (₹)","Shop Net (₹)","Confirmed Refunds (₹)","Cancellations","Unallocated (₹)","Settled Disbursed (₹)"');

    let sumOrders = 0;
    let sumRevenue = 0;
    let sumFee = 0;
    let sumNet = 0;
    let sumRefunds = 0;
    let sumCancels = 0;
    let sumUnallocated = 0;
    let sumSettled = 0;

    for (const s of report.shops) {
        lines.push(`"${s.shopName.replace(/"/g, '""')}",${s.ordersCount},${s.serviceRevenue},${s.xerServiceEarnings},${s.shopEarnings},${s.confirmedRefunds},${s.cancellationsCount},${s.unallocatedAmount},${s.settledAmount}`);
        sumOrders += s.ordersCount;
        sumRevenue += s.serviceRevenue;
        sumFee += s.xerServiceEarnings;
        sumNet += s.shopEarnings;
        sumRefunds += s.confirmedRefunds;
        sumCancels += s.cancellationsCount;
        sumUnallocated += s.unallocatedAmount;
        sumSettled += s.settledAmount;
    }

    // Exact Reconciled Total Row
    lines.push(`"TOTAL",${sumOrders},${Math.round(sumRevenue * 100) / 100},${Math.round(sumFee * 100) / 100},${Math.round(sumNet * 100) / 100},${Math.round(sumRefunds * 100) / 100},${sumCancels},${Math.round(sumUnallocated * 100) / 100},${Math.round(sumSettled * 100) / 100}`);

    return lines.join('\n');
}
