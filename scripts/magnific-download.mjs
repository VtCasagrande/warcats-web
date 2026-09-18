import {call} from './magnific-client.mjs';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import path from 'node:path';import sharp from 'sharp';
const manifest=JSON.parse(await readFile('artifacts/magnific-expansion/manifest.json','utf8'));
const base='public/assets/magnific/expansion';
function parse(result){if(result.structuredContent)return result.structuredContent.creations;const raw=result.content.find(x=>x.type==='text').text;try{return JSON.parse(raw).creations}catch{}return raw.split(/\n  - identifier: /).slice(1).map(block=>{const c={identifier:block.split('\n')[0]};for(const line of block.split('\n')){const m=line.match(/^    (\w+): (.+)$/);if(m){try{c[m[1]]=JSON.parse(m[2])}catch{c[m[1]]=m[2]}}}return c;});}
const entries=manifest.jobs.filter(j=>!j.key.startsWith('pbr/')).flatMap(j=>j.creations.map((c,i)=>({id:c.identifier,key:j.key+(i?'-'+(i+1):'')})));
for(let i=0;i<entries.length;i+=8){const group=entries.slice(i,i+8);let results;try{results=parse(await call('creations_get',{identifiers:group.map(e=>e.id)}));}catch(e){console.log('GET FAILED',String(e));continue;}
 const ready=results.filter(c=>c.status==='completed'&&c.url);if(ready.length)await call('creations_register_download',{identifiers:ready.map(c=>c.identifier)});
 for(const c of ready){const e=group.find(e=>e.id===c.identifier),ext=new URL(c.url).pathname.split('.').pop();const out=path.join(base,e.key+'.'+(['png','jpg','jpeg'].includes(ext)?'webp':ext));try{await access(out);continue}catch{}
 try{const res=await fetch(c.url);if(!res.ok)throw new Error('HTTP '+res.status);const buffer=Buffer.from(await res.arrayBuffer());await mkdir(path.dirname(out),{recursive:true});
 const archive=path.join('artifacts/magnific-expansion/originals',e.key+'.'+ext);await mkdir(path.dirname(archive),{recursive:true});await writeFile(archive,buffer);
 if(['png','jpg','jpeg'].includes(ext))await sharp(buffer).resize(e.key.startsWith('ref/')?1024:512,e.key.startsWith('ref/')?1024:512,{fit:'inside'}).webp({quality:83}).toFile(out);
 else if(ext==='svg'){let svg=buffer.toString();if(/<script|on\w+=|<foreignObject|(?:href|src)=["'](?:https?:|data:|javascript:)/i.test(svg))throw new Error('Unsafe SVG');await writeFile(out,svg);}
 else await writeFile(out,buffer);
 console.log('SAVED',out,buffer.length);
 }catch(error){console.log('DOWNLOAD FAILED',e.key,String(error));}
 }
 for(const c of results)if(c.status!=='completed')console.log('PENDING',c.identifier,c.status);
}
