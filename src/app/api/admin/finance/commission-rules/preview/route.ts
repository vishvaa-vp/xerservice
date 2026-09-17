import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin-auth';
import {
    calculateOrderCommission,
    simulateAstraplanScenario,
    CommissionRule,
    CommissionLineInput,
} from '@packages/backend/finance';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    const headers = { 'Cache-Control': 'no-store' };

    const auth = await requireAdminAuth(req);
    if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
    }

    try {
        const body = await req.json();

        // Check for Astraplan worked example scenario preset
        if (body.scenario && [1, 2, 3, 4].includes(Number(body.scenario))) {
            const scenarioNum = Number(body.scenario) as 1 | 2 | 3 | 4;
            const scenarioData = simulateAstraplanScenario(scenarioNum);
            return NextResponse.json({
                success: true,
                isPreset: true,
                ...scenarioData,
            }, { status: 200, headers });
        }

        const { rule, lines } = body;

        if (!rule) {
            return NextResponse.json({ error: 'Commission rule configuration is required.' }, { status: 400, headers });
        }

        const formattedRule: CommissionRule = {
            id: rule.id || 'preview-rule',
            shopId: rule.shopId || null,
            scope: rule.scope || 'SHOP_DEFAULT',
            calculationMethod: rule.calculationMethod || 'REVENUE_PERCENTAGE',
            serviceId: rule.serviceId || null,
            serviceName: rule.serviceName || null,
            rateValue: Number(rule.rateValue || rule.commissionPercentage || 0),
            unit: rule.unit || 'PHYSICAL_SHEET',
            costBasis: rule.costBasis !== undefined ? Number(rule.costBasis) : null,
            effectiveFrom: rule.effectiveFrom || new Date().toISOString(),
            effectiveTo: rule.effectiveTo || null,
            isActive: true,
        };

        const inputLines: CommissionLineInput[] = Array.isArray(lines) && lines.length > 0
            ? lines.map((l: any) => ({
                lineType: l.lineType || 'PRINTING',
                serviceId: l.serviceId,
                serviceName: l.serviceName || (l.lineType === 'ADDON' ? 'Finishing Add-on' : 'Printing Service'),
                revenue: Number(l.revenue || 0),
                costBasis: l.costBasis !== undefined ? Number(l.costBasis) : undefined,
                quantity: Number(l.quantity || 1),
                unitType: l.unitType || (l.lineType === 'ADDON' ? 'SERVICE_UNIT' : 'PHYSICAL_SHEET'),
            }))
            : [{
                lineType: 'PRINTING',
                revenue: Number(body.sampleRevenue || 10),
                costBasis: body.sampleCostBasis !== undefined ? Number(body.sampleCostBasis) : undefined,
                quantity: Number(body.sampleQuantity || 2),
                unitType: 'PHYSICAL_SHEET',
                serviceName: 'Sample Print Service',
            }];

        const result = calculateOrderCommission(inputLines, [formattedRule]);

        return NextResponse.json({
            success: true,
            isPreset: false,
            rule: formattedRule,
            result,
        }, { status: 200, headers });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 400, headers });
    }
}
