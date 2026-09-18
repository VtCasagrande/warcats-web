import {spawn} from 'node:child_process';import {setTimeout as delay} from 'node:timers/promises';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';import {WebSocket} from 'ws';import assert from 'node:assert/strict';
const {unpackState}=await import('../shared/protocol.ts'),{emptyInput}=await import('../shared/types.ts');
const port=34783,origin=`http://localhost:${port}`,data=await mkdtemp(join(tmpdir(),'warcats-competitive-'));
const server=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:String(port),ACCOUNT_BACKEND:'local',DATA_DIR:data,SECURE_COOKIES:'false'},stdio:['ignore','pipe','pipe']}),sockets=[];let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
const until=async(fn,label)=>{const deadline=Date.now()+5000;while(!await fn()&&Date.now()<deadline)await delay(30);assert.ok(await fn(),label);};
try{
 await until(async()=>{try{return(await fetch(origin+'/api/health')).ok;}catch{return false;}},'server ready');
 const registration=await fetch(origin+'/api/auth/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'competitive_qa',displayName:'Competitive QA',password:randomBytes(18).toString('hex')})});assert.equal(registration.status,201);
 const cookie=registration.headers.get('set-cookie').split(';')[0];
 async function connect(name,room='',auth=''){
  const ws=new WebSocket(origin.replace('http','ws')+'/ws',{headers:{Cookie:auth},origin});sockets.push(ws);const client={ws,id:'',room,state:null,seq:0,events:[]};
  ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='welcome'){client.id=m.id;client.room=m.room;client.state=unpackState(m.state);}if(m.type==='state'){client.state=unpackState(m.state);client.events.push(...client.state.events);}});
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});ws.send(JSON.stringify({type:'join',options:{name,team:0,weapon:'ar',sight:auth?'optic':'reflex',muzzle:auth?'supp':'stock',grip:auth?'vert':'stock',botCount:12,room}}));await until(()=>client.state,'welcome');return client;
 }
 const a=await connect('Buyer','',''+cookie),b=await connect('Observer',a.room);
 await until(()=>b.state.players[a.id]?.primarySight==='optic','observer receives equipped attachment');assert.equal(a.state.players[a.id].credits,8960);
 const purchase={type:'purchase',weapon:'ar',sight:'holo',muzzle:'comp',grip:'vert',cost:0,credits:999999};a.ws.send(JSON.stringify(purchase));
 await until(()=>b.state.players[a.id]?.primarySight==='holo','authoritative purchase reaches second client');assert.equal(b.state.players[a.id].credits,8560);
 a.ws.send(JSON.stringify(purchase));await delay(180);assert.equal(a.state.players[a.id].credits,8560);
 const input=values=>a.ws.send(JSON.stringify({type:'input',input:{...emptyInput(),seq:++a.seq,...values}}));
 a.ws.send(JSON.stringify({type:'loadout',weapon:'awm',sight:'optic',muzzle:'supp'}));input({equip:1});await until(()=>a.state.players[a.id].slot===1,'secondary slot');input({equip:0});await until(()=>a.state.players[a.id].slot===0,'primary slot');assert.equal(a.state.players[a.id].weapon,'ar');assert.equal(a.state.players[a.id].sight,'holo');assert.equal(a.state.players[a.id].credits,8560);
 await until(async()=>{const value=await(await fetch(origin+'/api/auth/me',{headers:{Cookie:cookie}})).json();return value.account?.cash===8560;},'persistent account cash');
 a.ws.send(JSON.stringify({type:'purchase',weapon:'constructor',cash:999999}));await delay(100);assert.equal(a.state.players[a.id].credits,8560);
 const acknowledgements=a.events.filter(e=>e.type==='purchase'&&e.player===a.id);assert.ok(acknowledgements.some(e=>e.value===400));
 await writeFile('artifacts/competitive/online.json',JSON.stringify({twoClients:true,authenticatedBuyer:true,initialPaidKit:1040,upgradeCost:400,finalCash:8560,duplicateCharge:0,forgedPricesIgnored:true,unpaidAttachmentsBlocked:true,persistedWallet:true,errors:[]},null,2));console.log('PASS two clients, authenticated attachment purchases, repeat idempotence, immutable server prices, anti-switch exploit, persisted wallet');
}finally{sockets.forEach(ws=>ws.terminate());server.kill('SIGTERM');await delay(200);await rm(data,{recursive:true,force:true});}
