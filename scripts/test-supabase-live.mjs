import { loadEnvFile } from 'node:process';
import { randomUUID, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
loadEnvFile('.env.server');
const base=process.env.SUPABASE_URL, service=process.env.SUPABASE_SERVICE_ROLE_KEY, anon=process.env.SUPABASE_ANON_KEY;
if (!base || !service || !anon) throw new Error('Configure the server-only Supabase environment.');
const ids=[], checks=[];
const record=(name)=>{checks.push(name);console.log('PASS',name)};
async function req(path,{key=service,token=key,method='GET',body}={}) {
 const response=await fetch(base+path,{method,headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{data=null}
 return {status:response.status,ok:response.ok,data};
}
try {
 const password=randomBytes(24).toString('base64url');
 const email=`warcats-qa-${Date.now()}@example.invalid`;
 for (let i=0;i<2;i++) {
  const r=await req('/auth/v1/admin/users',{method:'POST',body:{email:i?`other-${email}`:email,password,email_confirm:true,user_metadata:{display_name:'Operador QA',role:'admin'}}});
  assert.equal(r.ok,true,`QA creation failed (${r.status})`);ids.push(r.data.id);
 }
 record('Auth creates temporary test identities without sending email');
 const login=await req('/auth/v1/token?grant_type=password',{key:anon,method:'POST',body:{email,password}});
 assert.equal(login.ok,true,`QA login failed (${login.status})`);const jwt=login.data.access_token;
 const own=await req('/rest/v1/player_profiles?select=id,role,cash',{key:anon,token:jwt});
 assert.equal(own.ok,true);assert.equal(own.data.length,1);assert.equal(own.data[0].id,ids[0]);assert.equal(own.data[0].cash,10000);assert.equal(own.data[0].role,'player');
 record('RLS returns only the signed-in profile; metadata cannot grant admin');
 const injection=await req(`/rest/v1/player_profiles?id=eq.${ids[0]}`,{key:anon,token:jwt,method:'PATCH',body:{cash:999999,role:'admin'}});
 assert.ok([401,403].includes(injection.status));record('Authenticated browser cannot modify cash or role');
 for(const path of ['/rest/v1/player_profiles?select=id','/rest/v1/game_sessions?select=token_hash']){
  const r=await req(path,{key:anon});assert.ok([401,403].includes(r.status));
 }
 record('Anonymous requests cannot read profiles or sessions');
 const payload={p_id:randomUUID(),p_account_id:ids[0],p_expected_revision:0,p_cash:8400,p_kills:2,p_deaths:1,p_objective_seconds:15,p_results:[{matchId:'qa-'+randomUUID(),won:true}]};
 const denied=await req('/rest/v1/rpc/apply_account_checkpoint',{key:anon,token:jwt,method:'POST',body:payload});assert.ok([401,403].includes(denied.status));
 const adminDenied=await req('/rest/v1/rpc/admin_overview',{key:anon,token:jwt,method:'POST',body:{}});assert.ok([401,403].includes(adminDenied.status));record('Browser cannot invoke checkpoint or admin RPC');
 const first=await req('/rest/v1/rpc/apply_account_checkpoint',{method:'POST',body:payload});assert.equal(first.ok,true,`Checkpoint failed (${first.status})`);assert.equal(first.data[0].revision,1);assert.equal(first.data[0].cash,8400);assert.equal(first.data[0].wins,1);
 record('Authoritative checkpoint atomically saves purchase, progress and result');
 const replay=await req('/rest/v1/rpc/apply_account_checkpoint',{method:'POST',body:payload});assert.equal(replay.ok,true);assert.deepEqual(replay.data,first.data);record('Network retries do not duplicate debit or reward');
 const stale=await req('/rest/v1/rpc/apply_account_checkpoint',{method:'POST',body:{...payload,p_id:randomUUID()}});assert.equal(stale.data.code,'PT409');record('Concurrent stale revision is rejected');
 const second=await req('/rest/v1/rpc/apply_account_checkpoint',{method:'POST',body:{...payload,p_id:randomUUID(),p_expected_revision:1,p_kills:0,p_deaths:0,p_objective_seconds:0}});assert.equal(second.ok,true);assert.equal(second.data[0].wins,1);assert.equal(second.data[0].rounds,1);record('A round result is counted only once across checkpoints');
 const rows=await req('/rest/v1/match_results?select=match_id',{key:anon,token:jwt});assert.equal(rows.data.length,1);record('Account can read its persisted round history');
} finally {
 for(const id of ids){const r=await req(`/auth/v1/admin/users/${id}`,{method:'DELETE'});if(!r.ok)throw new Error(`QA cleanup failed (${r.status})`)}
 console.log('Temporary QA accounts and related records removed.');
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/supabase-live-report.json',JSON.stringify({date:new Date().toISOString(),project:'bdcsddepofahusokbhlp',checks,temporaryAccountsRemoved:ids.length},null,2));
}
