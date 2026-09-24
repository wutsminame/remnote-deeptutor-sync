import 'fake-indexeddb/auto';
import {beforeEach,expect,test,vi} from 'vitest';
import {Queue} from '../src/queue';
import {SyncEngine} from '../src/sync';
import {initialState,validateUrl,hash,type Batch,type Config} from '../src/types';
import type {ReactRNPlugin} from '@remnote/plugin-sdk';

function rem(id='r',text='alpha',extra:any={}) {return {_id:id,text:[text],backText:[],parent:null,children:[],type:0,
  updatedAt:1,localUpdatedAt:1,createdAt:1,getTagRems:async()=>[],remsBeingReferenced:async()=>[],isDocument:async()=>false,...extra};}
function harness(){
  const kb='kb-'+crypto.randomUUID(); const memory=new Map<string,any>(); let records:any[]=[rem()];
  const cfg:Config={url:'https://example.com',token:'test-token-long-enough',enabled:true};memory.set('rn-config-'+kb,cfg);
  const plugin={kb:{getCurrentKnowledgeBaseData:async()=>({_id:kb,name:'test'})},
    rem:{getAll:async()=>records,findOne:async(id:string)=>records.find(r=>r._id===id)},
    storage:{getLocal:async(key:string)=>memory.get(key),setLocal:async(key:string,value:any)=>{memory.set(key,value);}},
    richText:{toString:async(t:string[])=>t.join('')}} as unknown as ReactRNPlugin;
  const sent:Batch[]=[];
  const fetcher=vi.fn(async(_url:any,options:any)=>{const b=JSON.parse(options.body);sent.push(b);
    return new Response(JSON.stringify({ack_seq:b.seq,batch_id:b.batch_id}),{status:200});});
  const engine=new SyncEngine(plugin,fetcher as any);
  return {engine,plugin,kb,memory,cfg,sent,fetcher,setRecords:(r:any[])=>{records=r;}};
}
beforeEach(()=>{vi.stubGlobal('navigator',{locks:{request:async(_name:any,_opt:any,cb:any)=>cb({name:'lock'})}});});

test('HTTPS validation permits only explicit local development exception',()=>{
  expect(validateUrl('https://host.example/')).toBe('https://host.example');
  expect(validateUrl('http://localhost:8081')).toBe('http://localhost:8081');
  for(const url of ['http://example.com','https://user:token@host','https://host/?token=abc'])expect(()=>validateUrl(url)).toThrow();
});
test('full sync has ordered start/pages/commit with accurate serialized graph',async()=>{
  const h=harness();h.setRecords([rem('r','front',{backText:['answer'],parent:'p',children:['c'],getTagRems:async()=>[{_id:'t'}],remsBeingReferenced:async()=>[{_id:'ref'}]})]);
  await h.engine.tick();
  expect(h.sent.map(b=>b.kind)).toEqual(['snapshot_start','snapshot_page','snapshot_commit']);
  expect(h.sent.map(b=>b.seq)).toEqual([1,2,3]);
  expect(h.sent[1].records?.[0]).toMatchObject({text:'front',back_text:'answer',parent_id:'p',tags:['t'],references:['ref']});
  h.engine.stop();
});
test('event-triggered deep scan catches tag changes without timestamp update',async()=>{
  const h=harness();await h.engine.tick();
  const q=await Queue.open(await hash([h.cfg.url,h.kb]));const s=await q.state();s.lastScan=0;await q.enqueue([],s);
  h.setRecords([rem('r','alpha',{getTagRems:async()=>[{_id:'new-tag'}]})]);h.engine.signal();await h.engine.tick();
  expect(h.sent.at(-1)?.records?.[0].tags).toEqual(['new-tag']);q.db.close();h.engine.stop();
});
test('missed events are recovered by timestamp polling',async()=>{
  const h=harness();await h.engine.tick();
  const q=await Queue.open(await hash([h.cfg.url,h.kb]));const s=await q.state();s.lastScan=0;await q.enqueue([],s);
  h.setRecords([rem('r','renamed',{updatedAt:2})]);await h.engine.tick();
  expect(h.sent.at(-1)?.records?.[0].text).toBe('renamed');q.db.close();h.engine.stop();
});
test('deletion requires two inventories and negative findOne',async()=>{
  const h=harness();await h.engine.tick();h.setRecords([]);
  const q=await Queue.open(await hash([h.cfg.url,h.kb]));
  for(let i=0;i<2;i++){const s=await q.state();s.lastScan=0;await q.enqueue([],s);await h.engine.tick();
    if(i===0)expect(h.sent.at(-1)?.kind).toBe('snapshot_commit');}
  expect(h.sent.at(-1)?.deleted_ids).toEqual(['r']);q.db.close();h.engine.stop();
});
test('lost acknowledgement retains identical oldest batch after restart',async()=>{
  const h=harness();h.fetcher.mockImplementationOnce(async()=>{throw new Error('network');});await h.engine.tick();
  const q=await Queue.open(await hash([h.cfg.url,h.kb]));const oldest=await q.oldest();expect(await q.count()).toBe(3);
  h.engine.stop();await q.unblock();
  const restored=new SyncEngine(h.plugin,h.fetcher as any);await restored.tick();expect(h.sent[0]).toEqual(oldest);
  expect(await q.count()).toBe(0);q.db.close();restored.stop();
});
test('auth errors pause automatic retries and preserve queue',async()=>{
  const h=harness();h.fetcher.mockResolvedValue(new Response('{}',{status:403}));await h.engine.tick();await h.engine.tick();
  expect(h.fetcher).toHaveBeenCalledTimes(1);
  const q=await Queue.open(await hash([h.cfg.url,h.kb]));expect(await q.count()).toBe(3);expect((await q.retry())?.blocked).toBe(true);
  q.db.close();h.engine.stop();
});
test('explicit retry does not defeat the next backoff',async()=>{
  const h=harness();h.fetcher.mockResolvedValue(new Response('{}',{status:500}));
  h.memory.set('rn-request-'+h.kb,{kind:'retry',nonce:'unique'});await h.engine.tick();await h.engine.tick();
  expect(h.fetcher).toHaveBeenCalledTimes(1);h.engine.stop();
});
test('failed scan queues nothing and does not advance checkpoint',async()=>{
  const h=harness();h.setRecords([rem('r','alpha',{getTagRems:async()=>{throw new Error('SDK failure');}})]);await h.engine.tick();
  const q=await Queue.open(await hash([h.cfg.url,h.kb]));expect(await q.count()).toBe(0);expect((await q.state()).initialized).toBe(false);
  expect(h.fetcher).not.toHaveBeenCalled();q.db.close();h.engine.stop();
});
test('destination change creates a separate stream',async()=>{
  const h=harness();await h.engine.tick();h.cfg.url='https://new.example.com';await h.engine.tick();
  expect(h.sent[3].seq).toBe(1);expect(h.sent[3].client_id).not.toBe(h.sent[0].client_id);h.engine.stop();
});
test('queue and ledger transaction rollback together on duplicate sequence',async()=>{
  const q=await Queue.open(crypto.randomUUID()),s=initialState();
  const b:Batch={schema_version:1,kb_id:'kb',client_id:s.client,seq:1,batch_id:'b',kind:'snapshot_start',snapshot_id:'s'};
  s.nextSeq=2;await q.enqueue([b],s);const later={...s,nextSeq:99};
  await expect(q.enqueue([b],later)).rejects.toThrow();expect((await q.state()).nextSeq).toBe(2);q.db.close();
});
