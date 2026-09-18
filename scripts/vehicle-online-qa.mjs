import {spawn}from'node:child_process';import{setTimeout as delay}from'node:timers/promises';import{WebSocket}from'ws';import{writeFile,mkdtemp}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import assert from'node:assert/strict';
const{unpackState}=await import('../shared/protocol.ts');const{emptyInput}=await import('../shared/types.ts');
const port=34781,data=await mkdtemp(join(tmpdir(),'warcats-vehicle-qa-')),server=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:String(port),ACCOUNT_BACKEND:'local',DATA_DIR:data},stdio:['ignore','pipe','pipe']}),sockets=[];let logs='';server.stderr.on('data',s=>logs+=s);server.stdout.on('data',s=>logs+=s);
function once(ws,type){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Timeout '+type)),5000);const fn=raw=>{const m=JSON.parse(raw);if(m.type===type){clearTimeout(t);ws.off('message',fn);resolve(m);}};ws.on('message',fn);});}
try{let ready=false;for(let i=0;i<60;i++){try{if((await fetch(`http://localhost:${port}/api/health`)).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,logs);
 async function connect(name,room){const ws=new WebSocket(`ws://localhost:${port}/ws`);sockets.push(ws);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});const welcome=once(ws,'welcome');ws.send(JSON.stringify({type:'join',options:{name,team:0,weapon:'ar',botCount:12,room,skin:'woodland'}}));const w=await welcome;const client={ws,id:w.id,room:w.room,state:unpackState(w.state),seq:0};ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state')client.state=unpackState(m.state);});return client;}
 const a=await connect('Driver'),b=await connect('Passenger',a.room);await delay(100);
 const input=(c,values={})=>c.ws.send(JSON.stringify({type:'input',input:{...emptyInput(),seq:++c.seq,...values}}));
 const vId=a.state.vehicles.find(v=>v.team===0&&v.kind==='jeep').id;
 async function approach(c){for(let i=0;i<180;i++){const p=c.state.players[c.id],v=c.state.vehicles.find(v=>v.id===vId);const d=Math.hypot(p.x-v.x,p.z-v.z);if(d<4.8){input(c,{yaw:p.yaw,vehicle:true});await delay(200);return;}input(c,{yaw:Math.atan2(p.x-v.x,p.z-v.z),forward:1});await delay(34);}throw Error('Vehicle approach blocked');}
 await approach(a);assert.equal(a.state.players[a.id].vehicleId,vId);await approach(b);assert.equal(b.state.players[b.id].vehicleId,vId);assert.equal(a.state.players[a.id].vehicleSeat,0);
 const before=a.state.vehicles.find(v=>v.id===vId);const start={x:before.x,z:before.z};
 for(let i=0;i<36;i++){input(a,{forward:1});input(b);await delay(34);}
 for(let i=0;i<30;i++){input(a);input(b);await delay(34);}
 const current=a.state.vehicles.find(v=>v.id===vId),distance=Math.hypot(current.x-start.x,current.z-start.z);assert.ok(distance>3);assert.equal(b.state.players[a.id].vehicleId,vId);assert.ok(b.state.vehicles.find(v=>v.id===vId).distance>3);assert.equal(a.state.players[a.id].ammo,30);
 input(b,{vehicle:true});await delay(200);assert.equal(b.state.players[b.id].vehicleId,null);assert.ok(!b.state.vehicles.find(v=>v.id===vId).seats.includes(b.id));input(a,{vehicle:true});await delay(200);assert.equal(a.state.players[a.id].vehicleId,null);
 const report={online:true,twoClients:true,driverSeat:true,passengerSeat:true,authoritativeMovementMeters:+distance.toFixed(2),ammoPreserved:true,safeDisembark:true,errors:[]};await writeFile('artifacts/vehicle-online-report.json',JSON.stringify(report,null,2));console.log(report);
}finally{sockets.forEach(ws=>ws.terminate());server.kill('SIGTERM');}
