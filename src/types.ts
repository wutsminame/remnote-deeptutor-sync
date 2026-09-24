export type RecordData = {
  id:string; text:string; back_text:string; rich_text:unknown[]; rich_back_text:unknown[];
  parent_id:string|null; children:string[]; tags:string[]; references:string[];
  is_document:boolean; rem_type:number|string; created_at:number; updated_at:number; local_updated_at:number;
};
export type Batch = {
  schema_version:1; kb_id:string; client_id:string; seq:number; batch_id:string;
  kind:'snapshot_start'|'snapshot_page'|'snapshot_commit'|'delta'; snapshot_id?:string;
  expected_count?:number; records?:RecordData[]; deleted_ids?:string[];
};
export type Config = {url:string; token:string; enabled:boolean};
export type Known = {stamp:string; hash:string};
export type State = {
  client:string; nextSeq:number; initialized:boolean; known:Record<string,Known>;
  missing:string[]; lastDeep:number; lastScan:number; requestNonce:string;
};
export const initialState = ():State => ({client:crypto.randomUUID(),nextSeq:1,initialized:false,
  known:{},missing:[],lastDeep:0,lastScan:0,requestNonce:''});
export const validateUrl = (raw:string):string => {
  const url = new URL(raw.trim());
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new Error('服务器必须使用 HTTPS；只有本机测试允许 HTTP。');
  if (url.username || url.password || url.search || url.hash) throw new Error('URL 不得包含账号、查询参数或片段。');
  return url.toString().replace(/\/$/,'');
};
export async function hash(value:unknown) {
  const data = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
}
