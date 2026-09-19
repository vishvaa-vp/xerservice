// Isolated browser fixtures: no live sign-ins, uploads, payments, or database writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]; }));
const authKey = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const id='11111111-1111-4111-8111-111111111111', shopId='22222222-2222-4222-8222-222222222222', orderId='33333333-3333-4333-8333-333333333333';
const user={id,email:'fixture@example.invalid',role:'authenticated',aud:'authenticated',user_metadata:{full_name:'Test Customer'}};
const part=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const session={access_token:`${part({alg:'HS256',typ:'JWT'})}.${part({sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})}.fixture`,refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user};
const shop={id:shopId,name:'Campus Reprography',status:'OPEN',description:'Library Road, College Campus',owner_id:'vendor-fixture',open_time:'09:00',close_time:'18:00'};
const pdf=await PDFDocument.create(); for(let i=0;i<4;i++) pdf.addPage().drawText(`Document page ${i+1}`); const bytes=Buffer.from(await pdf.save());
const documents=[1,2].map(n=>({id:`44444444-4444-4444-8444-44444444444${n}`,original_filename:`${n}-Request-for-providing-working-space-and-student-reprography-services-with-a-long-document-name.pdf`,storage_path:`fixture/${n}.pdf`,mime_type:'application/pdf',file_size_bytes:bytes.length,original_pages:4,printable_pages:4,physical_sheets:2,unit_price:2,line_total:8,print_settings:{colour_mode:'BW',sides:'DOUBLE',orientation:'PORTRAIT',copies:1,pages_per_sheet:1,paper_size:'A4',margin:'DEFAULT',page_selection:'ALL',page_range:'',scale:100}}));
let paid=false, checks=0;
const check=(x,m)=>{assert.ok(x,m);checks++;console.log('PASS '+m)};
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.setRequestInterception(true);
page.on('request',async request=>{
 const url=new URL(request.url()), headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','content-type':'application/json'};
 if(url.hostname.endsWith('.supabase.co')||(url.origin===base&&url.pathname.startsWith('/api/'))){
  if(request.method()==='OPTIONS')return request.respond({status:204,headers});
  if(url.pathname.includes('/storage/'))return request.respond({status:200,headers:{...headers,'content-type':'application/pdf'},body:bytes});
  let data=[];
  if(url.pathname.includes('orders')||url.pathname.includes('order_files'))console.log('fixture request',url.pathname,url.searchParams.get('select'));
  if(url.pathname.endsWith('/auth/v1/user'))data=user;
  else if(url.pathname.endsWith('/profiles'))data={user_id:id,full_name:'Test Customer',role:'customer',phone:null};
  else if(url.pathname.endsWith('/shop_pricing'))data=['BW','COLOUR'].flatMap(mode=>['SINGLE','DOUBLE'].map(sides=>({shop_id:shopId,print_mode:mode,colour_mode:mode,paper_size:'A4',sides,price_per_sheet:2,active:true})));
  else if(url.pathname.endsWith('/shops'))data=url.searchParams.has('id')?shop:[shop];
  else if(url.pathname.endsWith('/order_files'))data=documents;
  else if(url.pathname.endsWith('/print_settings')){const patch=JSON.parse(request.postData()||'{}');for(const d of documents)Object.assign(d.print_settings,patch); data=documents.map(d=>({order_file_id:d.id}));}
  else if(url.pathname.endsWith('/orders'))data=url.pathname.startsWith('/api/')?{orders:[]}:{id:orderId,user_id:id,order_number:'XS-TEST',shop_id:shopId,shops:shop,total_amount:16,status:paid?'QUEUED':'DRAFT',payment_status:paid?'PAID':'PENDING',expires_at:new Date(Date.now()+3600000).toISOString(),order_files:documents,order_file_addons:[]};
  else if(url.pathname.endsWith('/quote'))data={orderId,orderNumber:'XS-TEST',totalAmount:16,totalOriginalPages:8,totalPrintablePages:8,totalPhysicalSheets:4,files:documents.map(d=>({orderFileId:d.id,lineTotal:8,physicalSheets:2,printablePages:4,addons:[]}))};
  else if(url.pathname.endsWith('/download'))data={downloadUrl:base+'/fixture.pdf'};
  else if(url.pathname.endsWith('/receipt'))data={available:false};
  else if(url.pathname.endsWith('/wallet'))data={balance:25,transactions:[]};
  else if(url.pathname.endsWith('/notifications'))data={notifications:[],unreadCount:0};
  else if(url.pathname.endsWith('/addons'))data={addons:[]};
  else if(url.pathname.endsWith('/whatsapp/status'))data={status:'not_linked'};
  return request.respond({status:200,headers,body:JSON.stringify(data)});
 }
 if(url.pathname==='/fixture.pdf')return request.respond({status:200,headers:{'content-type':'application/pdf'},body:bytes});
 if(url.origin!==base&&!['data:','blob:'].includes(url.protocol))return request.abort();
 return request.continue();
});
await page.evaluateOnNewDocument((session,key)=>{
 if(window!==window.top||location.origin!=='http://localhost:3000')return;
 sessionStorage.setItem('xs_app_booted','1');localStorage.setItem('xer_theme','light');localStorage.setItem(key,JSON.stringify(session));
 // Supabase realtime is not under test; never open sockets to the live service.
 window.WebSocket=class extends EventTarget{static OPEN=1;static CLOSED=3;readyState=3;send(){}close(){} };
},session,authKey);
const visit=async route=>{await page.goto(base+route,{waitUntil:'networkidle2'});await page.waitForFunction(()=>!document.querySelector('[aria-label="Loading XerService"]'));await page.addStyleTag({content:'nextjs-portal{display:none!important}'});};
async function fits(label){
 const overflow=await page.evaluate(()=>[...document.querySelectorAll('main button, main a, main select, main input:not([type=hidden]), .upload-file-card, .upload-dropzone, .upload-summary, [class*=paymentCard], [class*=previewContainer]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(r.right>innerWidth+1||r.left< -1)}).map(e=>`${e.tagName} ${e.textContent?.slice(0,50)}`));
 check(!overflow.length,`${label}: content and controls fit (${overflow.join('; ')})`);
}
fs.mkdirSync('reports/order-mobile-ui',{recursive:true});
try{
 for(const width of [320,375,390,412,430,768,844,1440]){
  await page.setViewport({width,height:width===844?390:924,isMobile:width<=844,hasTouch:width<=844});
  await visit(`/order/upload?shop=${shopId}&order=${orderId}`);await page.waitForSelector('.upload-file-card');await page.waitForFunction(()=>[...document.querySelectorAll('.upload-file-card')].every(e=>!e.textContent.includes('Analysing')));
  await fits(`upload ${width}`);
  check(await page.$eval('.upload-summary',e=>e.getBoundingClientRect().width>innerWidth*.7||innerWidth>768),'summary uses available phone width');
  await visit(`/order/pricing?order=${orderId}`);await page.waitForSelector('[aria-label="Choose a document to preview"] button');await page.waitForSelector('[aria-label="Live print preview"][aria-busy="false"]');
  await fits(`review ${width}`);
  const docs=await page.$$('[aria-label="Choose a document to preview"] button');await docs[1].click();check(await docs[1].evaluate(e=>e.getAttribute('aria-pressed')==='true'),`document 2 selectable at ${width}`);
  await page.waitForSelector('[aria-label="Live print preview"][aria-busy="false"]');
  await page.click('[aria-label="Flip sheet"]');check(await page.$eval('[aria-label="Flip sheet"]',e=>e.textContent.includes('Back')),`duplex flip at ${width}`);
  const add=await page.$eval('a[class*=editSettingsBtn]',e=>e.getAttribute('href'));check(add.includes(orderId)&&add.includes(shopId),`add PDF preserves order at ${width}`);
  if(width===412){await page.screenshot({path:'reports/order-mobile-ui/review-phone.png',fullPage:true});await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Edit Settings')).click());await page.waitForSelector('dialog[open]');await fits('settings dialog');check(await page.$eval('dialog',e=>e.textContent.includes('Save & add PDF')),'edit settings offers Add PDF');await page.click('[aria-label="Close print settings"]');}
  paid=true;await visit(`/order/pricing?order=${orderId}`);await page.waitForSelector('[class*=successCard]');await fits(`success ${width}`);if(width===412)await page.screenshot({path:'reports/order-mobile-ui/success-phone.png',fullPage:true});paid=false;
 }
 check(errors.length===0,`no runtime errors: ${errors.join('; ')}`);
 console.log(`${checks} checks passed. Network data is mocked; PDF rendering is real.`);
}catch(error){console.log(await page.evaluate(()=>document.body.innerText.slice(0,2500)));console.log(errors);throw error;}finally{await browser.close();}
