import assert from 'node:assert/strict';
import { processOrderPrint, syncOrderPrintStatus } from '../apps/desktop/src/main.ts';
import { setIpcInvoker } from '../apps/desktop/src/ipc.ts';
// Entirely isolated IPC and HTTP fixtures: no hardware, accounts, or backend are changed.
globalThis.window={};
let orders=[], jobs=new Map(), submissions=[], failReady=false;
const printer={printerId:'fixture',name:'Fixture printer',status:'idle',isDefault:true,capabilities:{supportedPaperSizes:['a4','a3','legal'],colorSupported:true,duplexSupported:true,maxCopies:100}};
setIpcInvoker(async(command,args)=>{
 if(command==='record_frontend_event')return true;
 if(command==='get_order_print_job')return jobs.get(args.orderId)||null;
 if(command==='list_printers')return [printer];
 if(command==='save_temp_document')return {tempPath:'/fixture/document.pdf',sha256Fingerprint:'fixture-hash',fileSizeBytes:10};
 if(command==='submit_print_job'){
   submissions.push(args);const job={localJobId:args.jobId,xerServiceOrderId:args.orderId,nativeJobId:'fixture-'+submissions.length,printerId:'fixture',status:'COMPLETED',managedByXerService:true};jobs.set(args.orderId,job);
   return {...job,jobId:args.jobId,submittedAt:new Date().toISOString(),message:'fixture'};
 }
 if(command==='get_print_job_status')return {jobId:args.jobId,status:'COMPLETED',nativeJobId:'fixture',printerId:'fixture'};
 throw Error('Unexpected fixture IPC '+command);
});
const savedFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 if(String(url).includes('/files/')) {assert.match(String(url),/prepared=true/);return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'application/pdf'}});}
 if(String(url).endsWith('/status')){
  const data=JSON.parse(options.body);if(failReady&&data.newStatus==='READY')return Response.json({error:'Disconnected'},{status:503});
  const order=orders.find(order=>String(url).includes(order.id));if(order.status!==data.expectedStatus)return Response.json({error:'Conflict'},{status:409});order.status=data.newStatus;return Response.json({status:order.status});
 }
 if(String(url).endsWith('/api/vendor/orders'))return Response.json({orders});
 throw Error('Unexpected fixture HTTP '+url);
};
const file=id=>({id,original_filename:id+'.pdf',mime_type:'application/pdf',print_settings:{colour_mode:'COLOUR',sides:'DOUBLE_SHORT_EDGE',orientation:'LANDSCAPE',copies:2,paper_size:'A4'},addons:[]});
const order=id=>({id,order_number:id,user_id:'customer-fixture',shop_id:'shop-fixture',payment_status:'PAID',status:'QUEUED',order_files:[file('one'),file('two')]});
let passed=0;
try {
 const multi=order('multi');orders=[multi];const result=await processOrderPrint(multi,'fixture','fixture-token','http://fixture');assert.equal(result.success,true);assert.equal(submissions.length,2);assert.equal(multi.status,'READY');passed++;
 assert.deepEqual(submissions.map(s=>s.orderId),['multi:one','multi:two']);assert.equal(submissions[0].colorMode,'color');assert.equal(submissions[0].duplexMode,'double_short');assert.equal(submissions[0].copies,2);passed++;
 await processOrderPrint(multi,'fixture','fixture-token','http://fixture');assert.equal(submissions.length,2);passed++;
 const finishing=order('finishing');finishing.order_files[0].addons=[{name:'Binding'}];orders=[finishing];await processOrderPrint(finishing,'fixture','fixture-token','http://fixture');assert.equal(finishing.status,'PRINTING');const sync=await syncOrderPrintStatus(finishing.id,'http://fixture','fixture-token');assert.equal(sync.printStatus,'COMPLETED');assert.equal(sync.orderStatus,'PRINTING');passed++;
 orders=[multi];multi.status='PRINTING';failReady=true;await assert.rejects(()=>syncOrderPrintStatus(multi.id,'http://fixture','fixture-token'),/Disconnected/);assert.equal(multi.status,'PRINTING');passed++;
 const count=submissions.length;const unpaid=order('unpaid');unpaid.payment_status='UNPAID';orders=[unpaid];const blocked=await processOrderPrint(unpaid,'fixture','fixture-token','http://fixture');assert.equal(blocked.success,false);assert.equal(submissions.length,count);passed++;
 console.log(`${passed} desktop handoff behavioral checks passed; physical printing not exercised.`);
} finally {globalThis.fetch=savedFetch;setIpcInvoker(null);delete globalThis.window;}
