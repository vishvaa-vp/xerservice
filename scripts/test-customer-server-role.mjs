import assert from 'node:assert/strict';
// Dedicated process with fixture configuration. Never reads project credentials.
process.env.NEXT_PUBLIC_SUPABASE_URL='http://fixture.invalid';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='fixture-publishable';
process.env.SUPABASE_SECRET_KEY='fixture-service';
let role='customer';
globalThis.fetch=async(url)=>{
 if(String(url).includes('/auth/v1/user'))return Response.json({id:'customer-fixture',email:'fixture@example.invalid'});
 if(String(url).includes('/rest/v1/profiles'))return Response.json(role?{role}:null);
 throw Error('Unexpected fixture request');
};
const {verifyCustomerToken}=await import('../packages/backend/src/supabase/client.ts');
assert.equal((await verifyCustomerToken('fixture-token')).userId,'customer-fixture');
for(const value of ['vendor','admin',null,'invalid']){role=value;assert.equal(await verifyCustomerToken('fixture-token'),null);}
assert.equal(await verifyCustomerToken(''),null);
console.log('6 server customer-role checks passed; no external requests.');
