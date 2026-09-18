/** Local authoring utility only. OAuth stays outside the repository and never enters the game bundle. */
import {readFileSync} from 'node:fs';import {homedir} from 'node:os';import {join} from 'node:path';
const url='https://mcp.magnific.com';let token=process.env.MAGNIFIC_ACCESS_TOKEN;
if(!token){try{const credentials=Object.values(JSON.parse(readFileSync(join(homedir(),'.codex','.credentials.json'),'utf8'))).find(c=>c.server_name==='magnific'&&c.server_url===url);token=credentials?.token_response?.access_token??credentials?.access_token;}catch{/* Surface only actionable status, never credential contents. */}}
if(!token)throw new Error('Autentique o MCP magnific no Codex ou forneça MAGNIFIC_ACCESS_TOKEN ao processo local.');
let session,seq=1;
export async function rpc(method,params){const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(session?{'Mcp-Session-Id':session}:{})},body:JSON.stringify({jsonrpc:'2.0',id:seq++,method,params}),signal:AbortSignal.timeout(45000)});session=response.headers.get('mcp-session-id')||session;const body=await response.text();if(!response.ok)throw new Error('Magnific HTTP '+response.status);return body.trim().startsWith('{')?JSON.parse(body):body.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))).at(-1);}
await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'warcats-assets',version:'1.0'}});
export async function call(name,args={}){const r=await rpc('tools/call',{name,arguments:args});if(r.error||r.result?.isError)throw new Error(JSON.stringify(r));return r.result;}
