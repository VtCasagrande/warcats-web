import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {validateMapDocument,mapWarnings,type MapDocument} from '../shared/map-editor';
import {AccountError} from './accounts';
type Record={draft:MapDocument;published:MapDocument|null;updatedBy:string;updatedAt:string};
export class MapStore{
 private records:Record[]=[];private queue:Promise<unknown>=Promise.resolve();
 constructor(private directory:string){}
 async initialize(){await mkdir(this.directory,{recursive:true});try{const data=JSON.parse(await readFile(join(this.directory,'maps.json'),'utf8'));if(!Array.isArray(data)||data.length>60)throw Error('Catálogo inválido');this.records=data.map(r=>({...r,draft:validateMapDocument(r.draft),published:r.published?validateMapDocument(r.published):null}));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 list(){return structuredClone(this.records);}
 published(){return this.records.flatMap(r=>r.published?[structuredClone(r.published)]:[]);}
 private async persist(records:Record[]){const file=join(this.directory,'maps.json'),temp=file+'.tmp';await writeFile(temp,JSON.stringify(records,null,2),{mode:0o600});await rename(temp,file);this.records=records;}
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result;}
 save(value:unknown,adminId:string){return this.serial(async()=>{
  let doc:MapDocument;try{doc=validateMapDocument(value);}catch(e){throw new AccountError((e as Error).message,400);}
  const records=this.list(),index=records.findIndex(r=>r.draft.id===doc.id),previous=records[index];
  if(previous&&previous.draft.revision!==doc.revision || !previous&&doc.revision!==0)throw new AccountError('Este mapa mudou em outra sessão. Reabra a versão atual antes de salvar.',409);
  if(index<0&&records.length>=60)throw new AccountError('Limite de 60 mapas atingido.',400);
  doc.revision++;const record={draft:doc,published:previous?.published??null,updatedBy:adminId,updatedAt:new Date().toISOString()};if(index<0)records.push(record);else records[index]=record;await this.persist(records);return structuredClone(record);
 });}
 publish(id:string,revision:number,adminId:string){return this.serial(async()=>{
  const records=this.list(),record=records.find(r=>r.draft.id===id);if(!record)throw new AccountError('Salve o rascunho primeiro.',404);
  if(record.draft.revision!==revision)throw new AccountError('O rascunho mudou. Reabra a versão atual.',409);
  const warnings=mapWarnings(record.draft);if(warnings.length)throw new AccountError(warnings.join(' '),400);
  record.published=structuredClone(record.draft);record.updatedBy=adminId;record.updatedAt=new Date().toISOString();await this.persist(records);return structuredClone(record);
 });}
}
