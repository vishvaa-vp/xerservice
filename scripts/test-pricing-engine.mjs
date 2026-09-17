import { evaluatePageSelection, calculateFilePricing } from '../src/lib/pricing-engine.ts';
import assert from 'node:assert';

console.log('Testing XerService Pricing Engine...');

// CASE A:
// 10-page PDF, ALL, 1 page/sheet, SINGLE, 1 copy, ₹2/sheet
const caseA = calculateFilePricing({
    originalPages: 10,
    pageSelection: 'ALL',
    pageRange: null,
    pagesPerSheet: 1,
    sides: 'SINGLE',
    copies: 1,
    unitPrice: 2,
});
assert.strictEqual(caseA.selectedPages, 10, 'Case A selectedPages');
assert.strictEqual(caseA.printablePages, 10, 'Case A printablePages');
assert.strictEqual(caseA.physicalSheets, 10, 'Case A physicalSheets');
assert.strictEqual(caseA.lineTotal, 20, 'Case A lineTotal');
console.log('✓ Case A passed');

// CASE B:
// 10-page PDF, ALL, 1 page/sheet, DOUBLE_LONG_EDGE, 1 copy, ₹3/sheet
const caseB = calculateFilePricing({
    originalPages: 10,
    pageSelection: 'ALL',
    pageRange: null,
    pagesPerSheet: 1,
    sides: 'DOUBLE_LONG_EDGE',
    copies: 1,
    unitPrice: 3,
});
assert.strictEqual(caseB.selectedPages, 10, 'Case B selectedPages');
assert.strictEqual(caseB.printablePages, 10, 'Case B printablePages');
assert.strictEqual(caseB.physicalSheets, 5, 'Case B physicalSheets');
assert.strictEqual(caseB.lineTotal, 15, 'Case B lineTotal');
console.log('✓ Case B passed');

// CASE C:
// 3-page PDF, ALL, 1 page/sheet, DOUBLE_LONG_EDGE, 2 copies, ₹3/sheet
const caseC = calculateFilePricing({
    originalPages: 3,
    pageSelection: 'ALL',
    pageRange: null,
    pagesPerSheet: 1,
    sides: 'DOUBLE_LONG_EDGE',
    copies: 2,
    unitPrice: 3,
});
assert.strictEqual(caseC.selectedPages, 3, 'Case C selectedPages');
assert.strictEqual(caseC.printablePages, 6, 'Case C printablePages');
assert.strictEqual(caseC.physicalSheets, 4, 'Case C physicalSheets');
assert.strictEqual(caseC.lineTotal, 12, 'Case C lineTotal');
console.log('✓ Case C passed');

// CASE D:
// 8-page PDF, ALL, 2 pages/sheet, SINGLE, 1 copy, ₹2/sheet
const caseD = calculateFilePricing({
    originalPages: 8,
    pageSelection: 'ALL',
    pageRange: null,
    pagesPerSheet: 2,
    sides: 'SINGLE',
    copies: 1,
    unitPrice: 2,
});
assert.strictEqual(caseD.selectedPages, 8, 'Case D selectedPages');
assert.strictEqual(caseD.printablePages, 8, 'Case D printablePages');
assert.strictEqual(caseD.physicalSheets, 4, 'Case D physicalSheets');
assert.strictEqual(caseD.lineTotal, 8, 'Case D lineTotal');
console.log('✓ Case D passed');

// CASE E:
// 10-page PDF, RANGE "1-3,5,8-10", 1 page/sheet, SINGLE, 1 copy, ₹2/sheet
const caseE = calculateFilePricing({
    originalPages: 10,
    pageSelection: 'RANGE',
    pageRange: '1-3,5,8-10',
    pagesPerSheet: 1,
    sides: 'SINGLE',
    copies: 1,
    unitPrice: 2,
});
assert.strictEqual(caseE.selectedPages, 7, 'Case E selectedPages');
assert.strictEqual(caseE.printablePages, 7, 'Case E printablePages');
assert.strictEqual(caseE.physicalSheets, 7, 'Case E physicalSheets');
assert.strictEqual(caseE.lineTotal, 14, 'Case E lineTotal');
console.log('✓ Case E passed');

// CASE F:
// 10-page PDF, ODD, 1 page/sheet, SINGLE, 3 copies, ₹2/sheet
const caseF = calculateFilePricing({
    originalPages: 10,
    pageSelection: 'ODD',
    pageRange: null,
    pagesPerSheet: 1,
    sides: 'SINGLE',
    copies: 3,
    unitPrice: 2,
});
assert.strictEqual(caseF.selectedPages, 5, 'Case F selectedPages');
assert.strictEqual(caseF.printablePages, 15, 'Case F printablePages');
assert.strictEqual(caseF.physicalSheets, 15, 'Case F physicalSheets');
assert.strictEqual(caseF.lineTotal, 30, 'Case F lineTotal');
console.log('✓ Case F passed');

// CASE G (Astraplan 6.3 worked example 1):
// 8-page PDF, ALL, 2 pages/sheet, DOUBLE_LONG_EDGE, 1 copy, ₹3/sheet
const caseG = calculateFilePricing({
    originalPages: 8,
    pageSelection: 'ALL',
    pageRange: null,
    pagesPerSheet: 2,
    sides: 'DOUBLE_LONG_EDGE',
    copies: 1,
    unitPrice: 3,
});
assert.strictEqual(caseG.selectedPages, 8, 'Case G selectedPages');
assert.strictEqual(caseG.printedSidesPerCopy, 4, 'Case G printedSidesPerCopy');
assert.strictEqual(caseG.sheetsPerCopy, 2, 'Case G sheetsPerCopy');
assert.strictEqual(caseG.physicalSheets, 2, 'Case G physicalSheets');
assert.strictEqual(caseG.lineTotal, 6, 'Case G lineTotal');
console.log('✓ Case G (8-page 2-up duplex) passed');

// CASE H (Astraplan 6.3 worked example 2):
// 5-page PDF, ALL, 2 pages/sheet, DOUBLE_LONG_EDGE, 1 copy, ₹3/sheet
const caseH = calculateFilePricing({
    originalPages: 5,
    pageSelection: 'ALL',
    pageRange: null,
    pagesPerSheet: 2,
    sides: 'DOUBLE_LONG_EDGE',
    copies: 1,
    unitPrice: 3,
});
assert.strictEqual(caseH.selectedPages, 5, 'Case H selectedPages');
assert.strictEqual(caseH.printedSidesPerCopy, 3, 'Case H printedSidesPerCopy');
assert.strictEqual(caseH.sheetsPerCopy, 2, 'Case H sheetsPerCopy');
assert.strictEqual(caseH.physicalSheets, 2, 'Case H physicalSheets');
assert.strictEqual(caseH.lineTotal, 6, 'Case H lineTotal');
console.log('✓ Case H (5-page 2-up duplex) passed');

// CASE I (4-up duplex with copies):
// 9-page PDF, ALL, 4 pages/sheet, DOUBLE_LONG_EDGE, 2 copies, ₹3/sheet
const caseI = calculateFilePricing({
    originalPages: 9,
    pageSelection: 'ALL',
    pageRange: null,
    pagesPerSheet: 4,
    sides: 'DOUBLE_LONG_EDGE',
    copies: 2,
    unitPrice: 3,
});
assert.strictEqual(caseI.selectedPages, 9, 'Case I selectedPages');
assert.strictEqual(caseI.printedSidesPerCopy, 3, 'Case I printedSidesPerCopy');
assert.strictEqual(caseI.sheetsPerCopy, 2, 'Case I sheetsPerCopy');
assert.strictEqual(caseI.physicalSheets, 4, 'Case I physicalSheets');
assert.strictEqual(caseI.lineTotal, 12, 'Case I lineTotal');
console.log('✓ Case I (9-page 4-up duplex 2 copies) passed');

// SECURITY & EDGE CASES:
// 1. Inverted range "5-3" must throw
assert.throws(() => {
    evaluatePageSelection(10, 'RANGE', '5-3');
}, /Inverted page range/);
console.log('✓ Inverted range rejection passed');

// 2. Out of bounds range "1-12" for 10-page PDF must throw
assert.throws(() => {
    evaluatePageSelection(10, 'RANGE', '1-12');
}, /exceeds the document total/);
console.log('✓ Out of bounds rejection passed');

// 3. Page 0 rejection
assert.throws(() => {
    evaluatePageSelection(10, 'RANGE', '0-4');
}, /greater than or equal to 1/);
console.log('✓ Page 0 rejection passed');

// 4. Duplicate page references "1,1,2" deduplication
const dupSelection = evaluatePageSelection(10, 'RANGE', '1,1,2');
assert.strictEqual(dupSelection.selectedPagesCount, 2, 'Duplicate pages deduplicated');
assert.deepStrictEqual(dupSelection.selectedPagesList, [1, 2]);
console.log('✓ Duplicate reference deduplication passed');

// 5. EVEN selection on 9-page doc (pages 2, 4, 6, 8 -> 4 pages)
const evenSelection = evaluatePageSelection(9, 'EVEN', null);
assert.strictEqual(evenSelection.selectedPagesCount, 4);
assert.deepStrictEqual(evenSelection.selectedPagesList, [2, 4, 6, 8]);
console.log('✓ EVEN selection passed');

console.log('\nAll pricing engine tests passed successfully!');
