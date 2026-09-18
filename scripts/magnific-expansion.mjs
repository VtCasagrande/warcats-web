import {call} from './magnific-client.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const path='artifacts/magnific-expansion/manifest.json';
const unpack=r=>r.structuredContent??JSON.parse(r.content.find(c=>c.type==='text').text);
let data;try{data=JSON.parse(await readFile(path,'utf8'))}catch{data={started:new Date().toISOString(),initialCredits:19562,jobs:[]};}
if(!data.folder){data.folder=unpack(await call('folders_create',{name:'WAR CATS · Combined Arms · Setembro 2026'})).reference;await writeFile(path,JSON.stringify(data,null,2));}
export {data,unpack};
export async function generate(key,tool,args){
 if(data.jobs.some(j=>j.key===key)){console.log('EXISTS',key);return;}
 const estimate=unpack(await call('simulate_cost',{tool,arguments:{...args,folderReference:data.folder}}));
 const balance=unpack(await call('account_balance',{})).credits.available;
 if((estimate.credits??999999)>balance){console.log('BUDGET',key,estimate.credits,balance);return;}
 try{
 const result=unpack(await call(tool,{...args,folderReference:data.folder}));
 const creations=result.creations??(result.creation?[result.creation]:[]);
 if(!creations.length)throw new Error('No creation queued');
 data.jobs.push({key,tool,args,creations,estimatedCredits:estimate.credits,createdAt:new Date().toISOString()});await writeFile(path,JSON.stringify(data,null,2));
 console.log('QUEUED',key,creations.map(c=>c.identifier).join(','),creations.reduce((sum,c)=>sum+(c.credits||0),0));
 }catch(e){console.log('FAILED',key,String(e).slice(0,250));}
}
const mode=process.argv[2];
if(mode==='initial'){
 const objects={jeep:'rugged four seat open top olive drab military utility jeep, four large off road tires, roll cage, empty seats, no gun, front left three quarter view',helicopter:'small olive drab six seat military transport helicopter, bubble cockpit, open side cabin with empty passenger benches, landing skids, tail rotor, main rotor with blades fully extended, front left three quarter view',ar:'compact tactical carbine rifle with short barrel, flat top rail, telescopic stock, box magazine, black phosphate and olive polymer, complete side profile',ak:'modern AK pattern rifle with curved magazine and wooden stock, steel barrel, complete side profile',m40:'precision bolt action sniper rifle with tan adjustable stock, long heavy barrel, optic scope, bipod folded, complete side profile',awm:'long range sniper rifle, angular olive folding stock, long fluted barrel, large scope, complete side profile',shotgun:'semi automatic tactical shotgun, black polymer pistol grip fixed stock, tubular magazine under barrel, complete side profile',pistol:'full size classic .45 service pistol, brushed dark steel slide and checkered olive grips, complete side profile',crate:'rugged olive military supply crate with metal corner protectors and fabric handles, fully closed, isolated front three quarter view'};
 for(const[key,desc]of Object.entries(objects))await generate('ref/'+key,'images_generate',{prompt:'Single isolated game asset reference: '+desc+'. Physically realistic proportions, manufactured details, neutral studio lighting, clean pale gray background, no people, no hands, no text, no logos, no extra objects, entire object inside frame, sharp silhouette, suitable for image to 3D reconstruction.',mode:'recraft-v4-1',tier:'pro',aspectRatio:['jeep','helicopter','crate'].includes(key)?'4:3':'2:1',count:1});
 for(const[key,desc]of Object.entries({woodland:'muted olive forest green brown and black organic camouflage',desert:'sand tan beige and dusty brown desert camouflage',arctic:'off white light gray graphite arctic fragmented camouflage',urban:'blue gray slate charcoal urban fractured camouflage',carbon:'matte black fine diagonal woven carbon fiber',ember:'burnt copper muted brick orange dark charcoal technical camouflage',naval:'deep navy blue desaturated teal and gray naval camouflage'}))await generate('skins/'+key,'images_generate',{prompt:'Seamless tileable flat material texture, '+desc+'. Premium tactical equipment finish, subtle realistic microtexture, uniform flat albedo illumination, no highlights shadows or perspective, no object, no text logo or border. Pattern fills every edge. Material for an original lightweight web military game.',mode:'recraft-v4-1',tier:'pro',aspectRatio:'1:1',count:1});
}
