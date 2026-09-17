import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
const base=process.env.TEST_BASE_URL||'http://localhost:3000';
const output=path.resolve('reports/customer-qa');fs.mkdirSync(output,{recursive:true});
const pdf=await PDFDocument.create();pdf.addPage();fs.writeFileSync(path.join(output,'fixture.pdf'),await pdf.save());
const id='11111111-1111-4111-8111-111111111111',shopId='22222222-2222-4222-8222-222222222222',orderId='33333333-3333-4333-8333-333333333333';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(line=>!line.startsWith('#')&&line.includes('=')).map(line=>{const i=line.indexOf('=');return [line.slice(0,i).trim(),line.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
const project=new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const session={access_token:`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')}.fixture`,refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id,email:'fixture@example.invalid',role:'authenticated',aud:'authenticated',user_metadata:{full_name:'Test customer'}}};
const browser=await puppeteer.launch({headless:true});let passed=0;
const check=(name,condition)=>{assert.ok(condition,name);passed++;console.log('PASS',name)};
async function fixture(role,{signedIn=true,recoveryFails=false}={}) {
 const context=await browser.createBrowserContext(),page=await context.newPage();const errors=[],writes=[],downloads=[];let storedOrder=null,paymentStatus='UNPAID';const storedFiles=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.text().includes('[ReviewAndPay]'))console.log(message.text());});await page.setRequestInterception(true);
 page.on('request',async request=>{
  const url=new URL(request.url());const method=request.method();
  if(url.hostname.endsWith('.supabase.co')){
   const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,DELETE,PATCH,PUT,OPTIONS','content-type':'application/json'};
   if(method==='OPTIONS')return request.respond({status:204,headers});
   if(method!=='GET')writes.push({path:url.pathname,method,body:request.postData()});
   let data=null,status=200;
   if(url.pathname.includes('/auth/v1/recover')){status=recoveryFails?429:200;data=recoveryFails?{msg:'Please wait before requesting another recovery link.'}:{};}
   else if(url.pathname.includes('/auth/v1/logout'))data={};
   else if(url.pathname.includes('/auth/v1/user'))data=session.user;
   else if(url.pathname.includes('/rest/v1/profiles'))data=role?{id,user_id:id,role,full_name:'Test customer'}:null;
   else if(url.pathname.includes('/rest/v1/shops')){const shop={id:shopId,name:'Test Print Shop',status:'OPEN',closing_soon:false,open_time:'09:00',close_time:'18:00'};data=url.searchParams.has('id')?shop:[shop];}
   else if(url.pathname.includes('/rest/v1/shop_pricing'))data=[{print_mode:'BW',colour_mode:'BW',price_per_page:2,price_per_sheet:2,paper_size:'A4',shop_id:shopId,sides:'SINGLE',is_active:true},{print_mode:'COLOUR',colour_mode:'COLOUR',price_per_page:7,price_per_sheet:7,paper_size:'A4',shop_id:shopId,sides:'SINGLE',is_active:true}];
   else if(url.pathname.includes('/rest/v1/orders')){if(method==='POST')storedOrder={id:orderId,user_id:id,order_number:'XS-TEST',shop_id:shopId,status:'DRAFT',payment_status:'UNPAID',total_amount:2,expires_at:new Date(Date.now()+3600000).toISOString(),shops:{id:shopId,name:'Test Print Shop'},order_file_addons:[]};data=storedOrder?{...storedOrder,order_files:storedFiles}:null;}
   else if(url.pathname.includes('/rest/v1/order_files')){if(method==='POST'){storedFiles.push(JSON.parse(request.postData()));}data=storedFiles;}
   else if(url.pathname.includes('/rest/v1/print_settings')){if(method==='POST'){const settings=JSON.parse(request.postData());const file=storedFiles.find(file=>file.id===settings.order_file_id);if(file)file.print_settings=settings;}data=storedFiles.map(file=>({order_file_id:file.id}));}
   else if(url.pathname.includes('/storage/v1/object/')){if(method==='GET'){downloads.push(url.pathname);return request.respond({status:200,headers:{...headers,'content-type':'application/pdf'},body:fs.readFileSync(path.join(output,'fixture.pdf'))});}data={Id:'fixture',Key:'fixture'};}
   else data=[];
   return request.respond({status,headers,body:JSON.stringify(data)});
  }
  if(url.origin===base&&url.pathname.startsWith('/api/')){
   if(url.pathname.endsWith('/payment/status'))return request.respond({status:200,contentType:'application/json',body:JSON.stringify({paymentStatus,orderNumber:'XS-TEST',safeToRetry:false})});
   if(url.pathname.endsWith('/quote'))return request.respond({status:200,contentType:'application/json',body:JSON.stringify({orderId,orderNumber:'XS-TEST',status:'DRAFT',totalOriginalPages:1,totalPrintablePages:1,totalSheets:1,totalAmount:2,printingSubtotal:2,addonsSubtotal:0,files:[]})});
   if(url.pathname.includes('/files/')&&url.pathname.endsWith('/download'))return request.respond({status:200,contentType:'application/json',body:JSON.stringify({downloadUrl:env.NEXT_PUBLIC_SUPABASE_URL+'/storage/v1/object/sign/fixture',filename:'fixture.pdf'})});
   if(url.pathname.endsWith('/payment/wallet')){storedOrder.payment_status='PAID';storedOrder.status='QUEUED';return request.respond({status:200,contentType:'application/json',body:JSON.stringify({orderNumber:'XS-TEST'})});}

   return request.respond({status:200,contentType:'application/json',body:JSON.stringify({orders:[],notifications:[],unreadCount:0,balance:25,transactions:[],addons:[]})});
  }
  return request.continue();
 });
 await page.evaluateOnNewDocument((key,value)=>{try { sessionStorage.setItem('xs_app_booted','1');if(value)localStorage.setItem(key,JSON.stringify(value)); } catch {}},`sb-${project}-auth-token`,signedIn?session:null);
 return {page,context,errors,writes,downloads,confirmPayment:()=>{paymentStatus='PAID';}};
}
try {
 for(const role of ['vendor','admin',null]){
  const f=await fixture(role);await f.page.goto(base+'/login?redirect=/order/upload',{waitUntil:'networkidle2'});
  await f.page.waitForSelector('.account-state');const body=await f.page.$eval('main',e=>e.innerText);
  check(`${role||'missing profile'} cannot become customer`,body.includes(role?'This is the customer website':'We couldn’t verify your account'));
  check(`${role||'missing profile'} does not reach upload`,new URL(f.page.url()).pathname !== '/order/upload');
  await f.page.goto(base+'/order/upload',{waitUntil:'networkidle2'});check(`${role||'missing profile'} direct upload denied`,await f.page.$('.account-state')!==null);check('no role-screen runtime errors',f.errors.length===0);await f.context.close();
 }
 const guest=await fixture(null,{signedIn:false});await guest.page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await guest.page.goto(base+'/login',{waitUntil:'networkidle2'});
 check('customer login has no vendor link',(await guest.page.$$('[href="/vendor/login"]')).length===0);
 check('mobile login fits viewport',await guest.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await guest.page.screenshot({path:path.join(output,'mobile-login.png'),fullPage:true});
 await guest.page.goto(base+'/forgot-password',{waitUntil:'networkidle2'});await guest.page.type('input[type=email]','fixture@example.invalid');await guest.page.click('button[type=submit],form button');await guest.page.waitForFunction(()=>document.body.innerText.includes('Check your inbox'));
 check('recovery calls real API contract',guest.writes.some(w=>w.path.endsWith('/recover')));check('no demo OTP in recovery',(await guest.page.$$('input[inputmode=numeric]')).length===0);
 await guest.page.goto(base+'/order/upload',{waitUntil:'networkidle2'});await guest.page.waitForFunction(()=>location.pathname==='/login');check('signed-out upload returns through login',guest.page.url().includes('redirect='));await guest.context.close();
 const failed=await fixture(null,{signedIn:false,recoveryFails:true});await failed.page.goto(base+'/forgot-password',{waitUntil:'networkidle2'});await failed.page.type('input[type=email]','fixture@example.invalid');await failed.page.click('form button');await failed.page.waitForSelector('[role=alert]');check('recovery failure never reports success',!(await failed.page.$eval('body',e=>e.innerText)).includes('Check your inbox'));await failed.context.close();
 const customer=await fixture('customer');await customer.page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await customer.page.goto(base+'/login?redirect=/dashboard/orders',{waitUntil:'networkidle2'});await customer.page.waitForFunction(()=>location.pathname==='/dashboard/orders');check('customer returns to intended page',true);
 await customer.page.goto(base+'/order/upload?shop='+shopId,{waitUntil:'networkidle2'});await customer.page.waitForSelector('input[type=file]');const input=await customer.page.$('input[type=file]');await input.uploadFile(path.join(output,'fixture.pdf'));
 await customer.page.waitForSelector('button[aria-label^="Print settings for"]:not([disabled])',{timeout:20000});
 check('PDF saved only after analysis and transfer',customer.writes.some(w=>w.path.includes('/storage/v1/object/'))&&customer.writes.some(w=>w.path.endsWith('/print_settings')));
 check('saved upload is PDF',customer.writes.some(w=>w.path.endsWith('/order_files')&&w.body?.includes('application/pdf')));
 await customer.page.waitForSelector('.upload-summary button:not([disabled])');check('ready upload can continue to payment',true);await customer.page.screenshot({path:path.join(output,'mobile-upload.png'),fullPage:true});check('upload fits mobile',await customer.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await customer.page.click('.upload-summary button');await customer.page.waitForFunction(()=>location.pathname==='/order/pricing');await customer.page.waitForNetworkIdle();
 check('upload reaches unified review',await customer.page.$('main')!==null);
 await customer.page.reload({waitUntil:'networkidle2'});
 await customer.page.waitForFunction(()=>{const canvas=document.querySelector('canvas[aria-label="Front of printed sheet"]');return canvas&&canvas.width>300&&document.querySelector('[aria-label="Live print preview"][aria-busy="false"]');});
 check('review restores saved PDF preview after refresh',customer.downloads.length>0);
 await customer.page.screenshot({path:path.join(output,'mobile-review.png'),fullPage:true});
 await customer.page.evaluate(orderId=>sessionStorage.setItem(`xer_payment_pending:${orderId}`,'1'),orderId);
 await customer.page.reload({waitUntil:'networkidle2'});
 await customer.page.waitForFunction(()=>document.body.innerText.includes('awaiting confirmation'));
 check('pending payment survives refresh and blocks repeat payment',await customer.page.evaluate(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent.includes('Pay ₹')&&button.disabled)));
 customer.confirmPayment();
 await customer.page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Check payment status').click());
 await customer.page.waitForFunction(()=>document.body.innerText.includes('Payment Successful!'));
 check('confirmed payment clears pending state',await customer.page.evaluate(orderId=>sessionStorage.getItem(`xer_payment_pending:${orderId}`)===null,orderId));
 assert.deepEqual(customer.errors, [], 'Customer runtime errors');check('no customer runtime errors',true);
 await customer.context.close();
 console.log(`${passed} browser checks passed with isolated authentication/storage/payment fixtures.`);
} finally {await browser.close();}
