import assert from 'node:assert/strict';
import { PDFDocument, degrees } from 'pdf-lib';
import { customerDestination, isCustomerPrivatePath } from '../src/lib/customer-navigation.ts';
import { preparePrintPdf } from '../src/lib/prepare-print-pdf.ts';
import { fromDbPrintSettings, toDbPrintSettings } from '../packages/shared/src/printing.ts';
import { transferDocument } from '../src/lib/document-transfer.ts';
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS', name); }
for (const url of ['https://evil.invalid','//evil.invalid','/\\evil.invalid','/vendor/dashboard','/admin','/auth/callback','/%2f%2fevil.invalid','/order/../vendor','/login','/%zz']) check(`reject unsafe destination ${url}`,()=>assert.equal(customerDestination(url),'/'));
check('preserve customer return intent',()=>assert.equal(customerDestination('/order/upload?shop=123#files'),'/order/upload?shop=123#files'));
check('customer protected routes',()=>{assert.equal(isCustomerPrivatePath('/dashboard/orders'),true);assert.equal(isCustomerPrivatePath('/shops'),false)});
const settings=fromDbPrintSettings({colour_mode:'COLOUR',sides:'DOUBLE_SHORT_EDGE',orientation:'LANDSCAPE',paper_size:'A4',copies:2,pages_per_sheet:2,page_selection:'ODD',scale:'CUSTOM',custom_scale:75});
check('persist custom scale and native settings',()=>{assert.equal(settings.customScale,75);assert.equal(settings.sides,'double_short');assert.equal(settings.color,'color');assert.equal(toDbPrintSettings(settings).custom_scale,75)});
const source=await PDFDocument.create();for(let i=0;i<5;i++){const page=source.addPage([595.28,841.89]);page.drawText(`Page ${i+1}`);if(i===2)page.setRotation(degrees(90));}const bytes=await source.save();
const prepared=await PDFDocument.load(await preparePrintPdf(bytes.buffer,settings,'fixture.pdf'));
check('actual N-up output honors selection and orientation',()=>{assert.equal(prepared.getPageCount(),2);assert.equal(prepared.getPage(0).getWidth(),841.89)});
await assert.rejects(()=>preparePrintPdf(bytes.buffer,{...settings,pageRange:'range',customRange:'99'},'fixture.pdf'));passed++;
class XHR {
 static last;upload={};headers={};status=200;
 constructor(){XHR.last=this}open(method,url){this.method=method;this.url=url}setRequestHeader(k,v){this.headers[k]=v}send(body){this.body=body}abort(){this.onabort()}
}
globalThis.XMLHttpRequest=XHR;
const file=new File([bytes],'fixture.pdf',{type:'application/pdf'});const options={url:'https://storage.invalid',key:'test-key',token:'test-token',path:'users/test/document.pdf',file};
const controller=new AbortController();let progress=-1;
const uploaded=transferDocument({...options,signal:controller.signal,onProgress:p=>progress=p});XHR.last.upload.onprogress({lengthComputable:true,loaded:25,total:100});check('progress comes from transferred bytes',()=>assert.equal(progress,25));XHR.last.onload();await uploaded;passed++;
const cancelled=new AbortController();const pending=transferDocument({...options,signal:cancelled.signal,onProgress:()=>{}});cancelled.abort();await assert.rejects(pending,{name:'AbortError'});passed++;
const failed=transferDocument({...options,signal:new AbortController().signal,onProgress:()=>{}});XHR.last.status=403;XHR.last.onload();await assert.rejects(failed,/session expired/);passed++;
console.log(`${passed} product domain checks passed (isolated fixtures; no live writes).`);
