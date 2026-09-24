import type {ReactRNPlugin} from '@remnote/plugin-sdk';
import {Queue} from './queue';
import {type Batch,type Config,type RecordData,type State,hash,validateUrl} from './types';

type Rem = Awaited<ReturnType<ReactRNPlugin['rem']['getAll']>>[number];
const stamp=(r:Rem)=>JSON.stringify([r.updatedAt,r.localUpdatedAt,r.text,r.backText,r.parent,r.children,r.type]);
const ids=(items:{_id:string}[])=>Array.from(new Set(items.map(r=>r._id))).sort();
export async function serialize(plugin:ReactRNPlugin,r:Rem):Promise<RecordData> {
  const [text,back,tags,refs,isDocument] = await Promise.all([
    plugin.richText.toString(r.text??[]),plugin.richText.toString(r.backText??[]),
    r.getTagRems(),r.remsBeingReferenced(),r.isDocument()]);
  return {id:r._id,text,back_text:back,rich_text:r.text??[],rich_back_text:r.backText??[],
    parent_id:r.parent??null,children:r.children??[],tags:ids(tags),references:ids(refs),is_document:isDocument,
    rem_type:r.type,created_at:r.createdAt??0,updated_at:r.updatedAt??0,local_updated_at:r.localUpdatedAt??0};
}

export function pack(records:RecordData[],deleted:string[],kind:Batch['kind'],base:Partial<Batch>):Partial<Batch>[] {
  const pages:Partial<Batch>[]=[];
  let group:RecordData[]=[], bytes=0;
  for (const record of records) {
    const size=new TextEncoder().encode(JSON.stringify(record)).length;
    if(size>6_000_000) throw new Error('单个 Rem 超过上传限制；请拆分该 Rem。');
    if(group.length>=100 || bytes+size>6_000_000) {pages.push({...base,kind,records:group});group=[];bytes=0;}
    group.push(record);bytes+=size;
  }
  if(group.length) pages.push({...base,kind,records:group});
  for(let i=0;i<deleted.length;i+=100) pages.push({...base,kind,deleted_ids:deleted.slice(i,i+100)});
  return pages;
}

export class SyncEngine {
  dirty=true; stopped=false; private busy=false; private currentNamespace=''; private queue?:Queue;
  constructor(private plugin:ReactRNPlugin,private fetcher:typeof fetch=fetch) {}
  signal=()=>{this.dirty=true;};
  stop(){this.stopped=true;this.queue?.db.close();}
  async report(message:string,extra:Record<string,unknown>={}) {
    await this.plugin.storage.setLocal('rn-status',{message,at:Date.now(),...extra});
  }
  async config(kb:string):Promise<Config|undefined> {return this.plugin.storage.getLocal<Config>('rn-config-'+kb);}
  async ensureKB(kb:string) {
    if(this.stopped || (await this.plugin.kb.getCurrentKnowledgeBaseData())._id!==kb)
      throw new Error('知识库已切换；本次扫描已取消。');
  }
  async tick() {
    if(this.busy || this.stopped)return;
    this.busy=true;
    try {
      const kb=(await this.plugin.kb.getCurrentKnowledgeBaseData())._id;
      const cfg=await this.config(kb);
      if(!cfg?.enabled || !cfg.token)return;
      cfg.url=validateUrl(cfg.url);
      const namespace=await hash([cfg.url,kb]);
      if(!navigator.locks)throw new Error('当前插件环境不支持 Web Locks，请使用新版 RemNote Desktop。');
      await navigator.locks.request('rn-sync-'+namespace,{ifAvailable:true},async lock=>{
        if(!lock)return;
        if(namespace!==this.currentNamespace){this.queue?.db.close();this.queue=await Queue.open(namespace);this.currentNamespace=namespace;}
        const queue=this.queue!;
        const request=await this.plugin.storage.getLocal<{kind:string;nonce:string}>('rn-request-'+kb);
        let state=await queue.state();
        const requested=!!request && request.nonce!==state.requestNonce;
        if(requested && await queue.db.get('meta','lastUnblockNonce')!==request!.nonce){
          await queue.unblock();
          await queue.db.put('meta',request!.nonce,'lastUnblockNonce');
        }
        if(!await this.flush(queue,kb,cfg))return;
        state=await queue.state();
        const full=!state.initialized || (requested && request?.kind==='full');
        if(full || requested || Date.now()-state.lastScan>60_000 || (this.dirty && Date.now()-state.lastScan>5000)) {
          const deep=full || this.dirty || Date.now()-state.lastDeep>6*3600_000;
          this.dirty=false;
          await this.scan(queue,state,kb,full,deep,request?.nonce);
          await this.flush(queue,kb,cfg);
        }
      });
    } catch(e) {this.dirty=true;await this.report(e instanceof Error?e.message:'同步错误');}
    finally {this.busy=false;}
  }
  async scan(queue:Queue,state:State,kb:string,full:boolean,deep:boolean,nonce?:string) {
    await this.report(full?'正在读取全量知识库…':'正在检查变化…');
    const all=await this.plugin.rem.getAll();
    const current=new Set(all.map(r=>r._id));
    if(current.size!==all.length)throw new Error('枚举返回重复 ID；未推进同步游标。');
    const next=structuredClone(state), changed:RecordData[]=[], deleted:string[]=[];
    for(let i=0;i<all.length;i+=8){
      await this.ensureKB(kb);
      await Promise.all(all.slice(i,i+8).map(async r=>{
        const s=stamp(r), prior=state.known[r._id];
        if(full || deep || !prior || prior.stamp!==s){
          const record=await serialize(this.plugin,r), h=await hash(record);
          if(full || prior?.hash!==h)changed.push(record);
          next.known[r._id]={stamp:s,hash:h};
        }
      }));
      if(i%400===0)await this.report('读取笔记中…',{processed:i,total:all.length});
    }
    const absent=Object.keys(state.known).filter(id=>!current.has(id));
    for(const id of absent) {
      // A negative findOne plus absence in two scans is required for a delta delete.
      if((full || state.missing.includes(id)) && !await this.plugin.rem.findOne(id)){
        deleted.push(id); delete next.known[id];
      }
    }
    if(full) {
      // A full snapshot removes unseen server rows only after a second complete ID inventory.
      const again=new Set((await this.plugin.rem.getAll()).map(r=>r._id));
      if(again.size!==current.size || [...current].some(id=>!again.has(id)))
        throw new Error('全量扫描期间笔记数量变化，稍后自动重试。');
      next.known=Object.fromEntries(Object.entries(next.known).filter(([id])=>current.has(id)));
    }
    await this.ensureKB(kb);
    const cfg=await this.config(kb);
    if(!cfg?.enabled || await hash([validateUrl(cfg.url),kb])!==this.currentNamespace)
      throw new Error('配置已改变，扫描已取消。');
    const snapshot=crypto.randomUUID();
    const pages=full ? [{kind:'snapshot_start',snapshot_id:snapshot},
      ...pack(changed,[],'snapshot_page',{snapshot_id:snapshot}),
      {kind:'snapshot_commit',snapshot_id:snapshot,expected_count:current.size}]
      :pack(changed,deleted,'delta',{});
    const batches=pages.map(page=>({...page,schema_version:1,kb_id:kb,client_id:state.client,
      seq:next.nextSeq++,batch_id:crypto.randomUUID()} as Batch));
    // Bound local offline storage; failed transaction leaves the previous ledger intact.
    if(new TextEncoder().encode(JSON.stringify(batches)).length>128*1024*1024)
      throw new Error('本次待同步数据超过 MVP 的 128 MiB 队列上限。');
    next.missing=absent.filter(id=>!deleted.includes(id));next.lastScan=Date.now();
    if(deep)next.lastDeep=Date.now();
    next.initialized=true;next.requestNonce=nonce??state.requestNonce;
    await queue.enqueue(batches,next);
    await this.report('扫描已保存到本地队列',{pending:await queue.count(),changed:changed.length,deleted:deleted.length});
  }
  async flush(queue:Queue,kb:string,cfg:Config):Promise<boolean> {
    const retry=await queue.retry();
    if(retry && (retry.blocked || retry.at>Date.now())) {
      await this.report(retry.blocked?'上传暂停：请检查 token/冲突/批次限制，再点重试。':'等待重试…',{pending:await queue.count(),retryAt:retry.at});
      return false;
    }
    let batch:Batch|undefined;
    // Bound each tick, keeping the host responsive on large initial queues.
    for(let sent=0;sent<20 && (batch=await queue.oldest());sent++){
      await this.ensureKB(kb);
      const live=await this.config(kb);
      if(!live?.enabled || validateUrl(live.url)!==cfg.url || live.token!==cfg.token)return false;
      try{
        const response=await this.fetcher(cfg.url+'/v1/sync',{method:'POST',redirect:'error',
          headers:{'Authorization':'Bearer '+cfg.token,'Content-Type':'application/json'},
          body:JSON.stringify(batch),signal:AbortSignal.timeout(30_000)});
        if(!response.ok){
          const blocked=response.status>=400 && response.status<500 && ![408,429].includes(response.status);
          const after=response.headers.get('Retry-After');
          const delay=after?(/^[0-9]+$/.test(after)?Number(after)*1000:Math.max(0,Date.parse(after)-Date.now())):0;
          await queue.failed(blocked,Number.isFinite(delay)?delay:0);
          await this.report('上传失败 HTTP '+response.status+'；队列已保留。',{pending:await queue.count()});return false;
        }
        const ack=await response.json();
        if(ack.ack_seq!==batch.seq || ack.batch_id!==batch.batch_id)throw new Error('ACK mismatch');
        await queue.ack(batch);
      }catch{
        await queue.failed(false);await this.report('连接中断或确认不匹配；队列已保留，自动重试。');return false;
      }
    }
    const pending=await queue.count();
    await this.report(pending?'正在上传…':'同步完成',{pending,kbId:kb,lastSuccess:Date.now()});
    return pending===0;
  }
}
