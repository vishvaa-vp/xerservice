/**
 * Commission Engine - Authoritative Multi-Model Commission & Precedence Resolver
 * Implements Astraplan Section 8 (Commission policies and accounting)
 */

export type CommissionCalculationMethod =
    | 'REVENUE_PERCENTAGE'
    | 'CONFIGURED_PROFIT_PERCENTAGE'
    | 'FIXED_PER_UNIT';

export type CommissionScope =
    | 'GLOBAL'
    | 'SHOP_DEFAULT'
    | 'PRINTING'
    | 'ADDONS'
    | 'SPECIFIC_SERVICE';

export type CommissionUnit =
    | 'PHYSICAL_SHEET'
    | 'PRINTED_SIDE'
    | 'DOCUMENT_PAGE'
    | 'SERVICE_UNIT'
    | 'ORDER';

export interface CommissionRule {
    id: string;
    shopId: string | null; // null represents global/platform default
    scope: CommissionScope;
    calculationMethod: CommissionCalculationMethod;
    serviceId?: string | null; // specific service / addon ID if scope is SPECIFIC_SERVICE
    serviceName?: string | null;
    rateValue: number; // percentage (e.g. 10 for 10%) or fixed fee in INR (e.g. 0.25 for ₹0.25)
    commissionBps?: number; // basis points equivalent if percentage-based (e.g. 1000 for 10%)
    unit?: CommissionUnit; // unit type when method is FIXED_PER_UNIT
    costBasis?: number | null; // default direct cost if method is CONFIGURED_PROFIT_PERCENTAGE
    effectiveFrom: string;
    effectiveTo?: string | null;
    isActive: boolean;
    version?: number;
    createdAt?: string;
    createdBy?: string | null;
    description?: string;
}

export interface CommissionLineInput {
    lineType: 'PRINTING' | 'ADDON';
    serviceId?: string;
    serviceName?: string;
    revenue: number; // customer gross amount for this line (in INR)
    costBasis?: number; // direct cost basis if applicable (in INR)
    quantity: number; // number of units (sheets, sides, pages, items)
    unitType: CommissionUnit;
}

export interface CommissionLineResult {
    lineType: 'PRINTING' | 'ADDON';
    serviceId?: string;
    serviceName?: string;
    revenue: number;
    costBasis?: number;
    ruleId: string;
    ruleScope: CommissionScope;
    calculationMethod: CommissionCalculationMethod;
    rateValue: number;
    unitType: CommissionUnit;
    quantity: number;
    fee: number; // XerService platform commission (in INR)
    shopEarnings: number; // Shop net earnings (in INR)
    formulaExplanation: string;
}

export interface CommissionOrderResult {
    grossAmount: number;
    platformCommission: number;
    vendorNet: number;
    effectiveBps: number;
    lines: CommissionLineResult[];
}

/**
 * Calculates commission for a single order line item according to the specified rule.
 * Enforces:
 * 1. Exact two-decimal integer paise rounding.
 * 2. Fee cap at eligible revenue so shop earnings cannot be negative.
 * 3. Exact invariant: revenue === fee + shopEarnings.
 */
export function calculateLineCommission(
    input: CommissionLineInput,
    rule: CommissionRule
): CommissionLineResult {
    const revenue = Math.round(Number(input.revenue || 0) * 100) / 100;
    let fee = 0;
    let formula = '';

    if (rule.calculationMethod === 'REVENUE_PERCENTAGE') {
        const pct = Number(rule.rateValue);
        // fee = revenue * (percentage / 100)
        fee = Math.round(revenue * (pct / 100) * 100) / 100;
        formula = `₹${revenue.toFixed(2)} × ${pct}% = ₹${fee.toFixed(2)}`;
    } else if (rule.calculationMethod === 'CONFIGURED_PROFIT_PERCENTAGE') {
        const pct = Number(rule.rateValue);
        const costBasis = Math.round(Number(input.costBasis ?? rule.costBasis ?? 0) * 100) / 100;
        const profit = Math.max(0, Math.round((revenue - costBasis) * 100) / 100);
        // fee = max(revenue - costBasis, 0) * (percentage / 100)
        fee = Math.round(profit * (pct / 100) * 100) / 100;
        formula = `max(₹${revenue.toFixed(2)} - ₹${costBasis.toFixed(2)}, 0) × ${pct}% = ₹${fee.toFixed(2)}`;
    } else if (rule.calculationMethod === 'FIXED_PER_UNIT') {
        const fixedFee = Number(rule.rateValue);
        const qty = Number(input.quantity || 1);
        // fee = quantity * fixedFee
        fee = Math.round(qty * fixedFee * 100) / 100;
        formula = `${qty} ${input.unitType.toLowerCase()}(s) × ₹${fixedFee.toFixed(2)} = ₹${fee.toFixed(2)}`;
    } else {
        throw new Error(`Unsupported commission calculation method: ${rule.calculationMethod}`);
    }

    // Safety Cap: Commission cannot exceed eligible line revenue unless explicitly subsidized
    if (fee > revenue) {
        fee = revenue;
        formula += ` (capped at revenue ₹${revenue.toFixed(2)})`;
    }
    if (fee < 0) {
        fee = 0;
    }

    const shopEarnings = Math.round((revenue - fee) * 100) / 100;

    return {
        lineType: input.lineType,
        serviceId: input.serviceId,
        serviceName: input.serviceName,
        revenue,
        costBasis: input.costBasis ?? rule.costBasis ?? undefined,
        ruleId: rule.id,
        ruleScope: rule.scope,
        calculationMethod: rule.calculationMethod,
        rateValue: rule.rateValue,
        unitType: input.unitType,
        quantity: input.quantity,
        fee,
        shopEarnings,
        formulaExplanation: formula,
    };
}

/**
 * Resolves the single winning effective commission rule for an order line item.
 * Precedence hierarchy (highest specificity wins):
 * 1. SPECIFIC_SERVICE: Rule for this specific add-on or service ID
 * 2. CATEGORY: Rule for PRINTING or ADDONS category
 * 3. SHOP_DEFAULT: Default rule for this shop
 * 4. GLOBAL: Platform-wide default rule
 *
 * Rejects ambiguous overlapping rules of equal specificity.
 */
export function resolveEffectiveRule(
    line: CommissionLineInput,
    availableRules: CommissionRule[],
    timestamp: string = new Date().toISOString()
): CommissionRule {
    const targetTime = new Date(timestamp).getTime();

    // Filter rules valid at timestamp
    const activeRules = availableRules.filter(r => {
        if (!r.isActive) return false;
        const start = new Date(r.effectiveFrom).getTime();
        const end = r.effectiveTo ? new Date(r.effectiveTo).getTime() : Infinity;
        return targetTime >= start && targetTime < end;
    });

    // 1. Check for specific service override
    if (line.serviceId) {
        const specificRules = activeRules.filter(
            r => r.scope === 'SPECIFIC_SERVICE' && r.serviceId === line.serviceId
        );
        if (specificRules.length > 1) {
            throw new Error(`Ambiguous commission rules: ${specificRules.length} overlapping specific service rules for service ${line.serviceId}.`);
        }
        if (specificRules.length === 1) {
            return specificRules[0];
        }
    }

    // 2. Check for category override (PRINTING or ADDONS)
    const categoryScope: CommissionScope = line.lineType === 'PRINTING' ? 'PRINTING' : 'ADDONS';
    const categoryRules = activeRules.filter(r => r.scope === categoryScope);
    if (categoryRules.length > 1) {
        throw new Error(`Ambiguous commission rules: ${categoryRules.length} overlapping category rules for ${categoryScope}.`);
    }
    if (categoryRules.length === 1) {
        return categoryRules[0];
    }

    // 3. Check for shop default rule
    const shopDefaultRules = activeRules.filter(r => r.scope === 'SHOP_DEFAULT');
    if (shopDefaultRules.length > 1) {
        throw new Error(`Ambiguous commission rules: ${shopDefaultRules.length} overlapping shop default rules.`);
    }
    if (shopDefaultRules.length === 1) {
        return shopDefaultRules[0];
    }

    // 4. Check for global / platform default rule
    const globalRules = activeRules.filter(r => r.scope === 'GLOBAL');
    if (globalRules.length > 1) {
        throw new Error(`Ambiguous commission rules: ${globalRules.length} overlapping global default rules.`);
    }
    if (globalRules.length === 1) {
        return globalRules[0];
    }

    throw new Error(`No active commission rule matches line item "${line.serviceName || line.lineType}". Commission setup is required.`);
}

/**
 * Evaluates commission across all line items of an order.
 * Guarantees that:
 * 1. Rounding is performed once per line, then summed.
 * 2. Gross Amount === Platform Commission + Vendor Net.
 * 3. Effective basis points are calculated from authoritative sums.
 */
export function calculateOrderCommission(
    lines: CommissionLineInput[],
    rules: CommissionRule[],
    timestamp: string = new Date().toISOString()
): CommissionOrderResult {
    if (!lines || lines.length === 0) {
        return {
            grossAmount: 0,
            platformCommission: 0,
            vendorNet: 0,
            effectiveBps: 0,
            lines: [],
        };
    }

    const evaluatedLines: CommissionLineResult[] = [];
    let grossSum = 0;
    let feeSum = 0;
    let netSum = 0;

    for (const line of lines) {
        const winningRule = resolveEffectiveRule(line, rules, timestamp);
        const lineRes = calculateLineCommission(line, winningRule);

        evaluatedLines.push(lineRes);
        grossSum += lineRes.revenue;
        feeSum += lineRes.fee;
        netSum += lineRes.shopEarnings;
    }

    const roundedGross = Math.round(grossSum * 100) / 100;
    const roundedFee = Math.round(feeSum * 100) / 100;
    const roundedNet = Math.round((roundedGross - roundedFee) * 100) / 100;

    const effectiveBps = roundedGross > 0
        ? Math.round((roundedFee / roundedGross) * 10000)
        : 0;

    return {
        grossAmount: roundedGross,
        platformCommission: roundedFee,
        vendorNet: roundedNet,
        effectiveBps,
        lines: evaluatedLines,
    };
}

/**
 * Standard worked example simulator for Astraplan Section 8.2 scenarios.
 */
export function simulateAstraplanScenario(scenarioNumber: 1 | 2 | 3 | 4): {
    scenario: string;
    customerAmount: number;
    xerserviceFee: number;
    shopEarnings: number;
    result: CommissionOrderResult;
} {
    if (scenarioNumber === 1) {
        // Scenario 1: Two single-sided ₹2 sheets, 10% of revenue
        const rule: CommissionRule = {
            id: 'scenario-1-rule',
            shopId: 'mock-shop',
            scope: 'SHOP_DEFAULT',
            calculationMethod: 'REVENUE_PERCENTAGE',
            rateValue: 10,
            commissionBps: 1000,
            effectiveFrom: '2020-01-01T00:00:00Z',
            isActive: true,
        };
        const lines: CommissionLineInput[] = [{
            lineType: 'PRINTING',
            revenue: 4.00,
            quantity: 2,
            unitType: 'PHYSICAL_SHEET',
            serviceName: 'A4 B&W Single-sided Printing',
        }];
        const res = calculateOrderCommission(lines, [rule]);
        return {
            scenario: 'Two single-sided ₹2 sheets, 10% of revenue',
            customerAmount: 4.00,
            xerserviceFee: 0.40,
            shopEarnings: 3.60,
            result: res,
        };
    }

    if (scenarioNumber === 2) {
        // Scenario 2: Same sale, configured total direct cost ₹2.40, 10% of configured profit
        const rule: CommissionRule = {
            id: 'scenario-2-rule',
            shopId: 'mock-shop',
            scope: 'SHOP_DEFAULT',
            calculationMethod: 'CONFIGURED_PROFIT_PERCENTAGE',
            rateValue: 10,
            commissionBps: 1000,
            effectiveFrom: '2020-01-01T00:00:00Z',
            isActive: true,
        };
        const lines: CommissionLineInput[] = [{
            lineType: 'PRINTING',
            revenue: 4.00,
            costBasis: 2.40,
            quantity: 2,
            unitType: 'PHYSICAL_SHEET',
            serviceName: 'A4 B&W Single-sided Printing',
        }];
        const res = calculateOrderCommission(lines, [rule]);
        return {
            scenario: 'Two single-sided ₹2 sheets, cost ₹2.40, 10% of configured profit',
            customerAmount: 4.00,
            xerserviceFee: 0.16,
            shopEarnings: 3.84,
            result: res,
        };
    }

    if (scenarioNumber === 3) {
        // Scenario 3: Same sale, ₹0.25 per physical sheet
        const rule: CommissionRule = {
            id: 'scenario-3-rule',
            shopId: 'mock-shop',
            scope: 'SHOP_DEFAULT',
            calculationMethod: 'FIXED_PER_UNIT',
            rateValue: 0.25,
            unit: 'PHYSICAL_SHEET',
            effectiveFrom: '2020-01-01T00:00:00Z',
            isActive: true,
        };
        const lines: CommissionLineInput[] = [{
            lineType: 'PRINTING',
            revenue: 4.00,
            quantity: 2,
            unitType: 'PHYSICAL_SHEET',
            serviceName: 'A4 B&W Single-sided Printing',
        }];
        const res = calculateOrderCommission(lines, [rule]);
        return {
            scenario: 'Two single-sided ₹2 sheets, ₹0.25 per physical sheet',
            customerAmount: 4.00,
            xerserviceFee: 0.50,
            shopEarnings: 3.50,
            result: res,
        };
    }

    if (scenarioNumber === 4) {
        // Scenario 4: Printing ₹4 at 10%, binding ₹20 at 5%
        const printingRule: CommissionRule = {
            id: 'scenario-4-print-rule',
            shopId: 'mock-shop',
            scope: 'PRINTING',
            calculationMethod: 'REVENUE_PERCENTAGE',
            rateValue: 10,
            commissionBps: 1000,
            effectiveFrom: '2020-01-01T00:00:00Z',
            isActive: true,
        };
        const addonRule: CommissionRule = {
            id: 'scenario-4-addon-rule',
            shopId: 'mock-shop',
            scope: 'ADDONS',
            calculationMethod: 'REVENUE_PERCENTAGE',
            rateValue: 5,
            commissionBps: 500,
            effectiveFrom: '2020-01-01T00:00:00Z',
            isActive: true,
        };
        const lines: CommissionLineInput[] = [
            {
                lineType: 'PRINTING',
                revenue: 4.00,
                quantity: 2,
                unitType: 'PHYSICAL_SHEET',
                serviceName: 'Printing',
            },
            {
                lineType: 'ADDON',
                revenue: 20.00,
                quantity: 1,
                unitType: 'SERVICE_UNIT',
                serviceName: 'Binding',
            },
        ];
        const res = calculateOrderCommission(lines, [printingRule, addonRule]);
        return {
            scenario: 'Printing ₹4 at 10%, binding ₹20 at 5%',
            customerAmount: 24.00,
            xerserviceFee: 1.40,
            shopEarnings: 22.60,
            result: res,
        };
    }

    throw new Error(`Unknown scenario number: ${scenarioNumber}`);
}
