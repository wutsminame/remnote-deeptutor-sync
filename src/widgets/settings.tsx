import React,{useEffect,useState} from 'react';
import {renderWidget,usePlugin} from '@remnote/plugin-sdk';
import {type Config,validateUrl} from '../types';

function Settings(){
  const plugin=usePlugin();
  const [kb,setKB]=useState(''),[url,setURL]=useState(''),[token,setToken]=useState('');
  const [enabled,setEnabled]=useState(false),[message,setMessage]=useState(''),[status,setStatus]=useState('');
  useEffect(()=>{let active=true;void(async()=>{
    const data=await plugin.kb.getCurrentKnowledgeBaseData();
    const cfg=await plugin.storage.getLocal<Config>('rn-config-'+data._id);
    if(active){setKB(data._id);setURL(cfg?.url??'');setToken(cfg?.token??'');setEnabled(cfg?.enabled??false);}
  })();const t=setInterval(async()=>{const s=await plugin.storage.getLocal('rn-status');if(active)setStatus(JSON.stringify(s,null,2));},2000);
    return()=>{active=false;clearInterval(t);};},[]);
  async function request(kind:string){
    if((await plugin.kb.getCurrentKnowledgeBaseData())._id!==kb)throw new Error('知识库已切换，请重新打开配置。');
    await plugin.storage.setLocal('rn-request-'+kb,{kind,nonce:crypto.randomUUID()});
  }
  async function save(){try{
    if(!kb || token.length<20)throw new Error('请填写服务器生成的 sync token。');
    await request('retry');
    await plugin.storage.setLocal('rn-config-'+kb,{url:validateUrl(url),token,enabled});setMessage('配置已保存。');
  }catch(e){setMessage(String(e));}}
  return <main className="deeptutor-settings" style={{fontFamily:'system-ui',maxWidth:650,padding:24,lineHeight:1.7}}>
    <style>{`
      .deeptutor-settings .config-field { display:block; margin:16px 0; font-weight:600; }
      .deeptutor-settings .config-input {
        display:block; box-sizing:border-box; width:100%; min-height:44px; margin-top:6px;
        padding:10px 12px; border:1px solid #8a8a8a; border-radius:6px;
        background:rgba(127,127,127,.06); color:inherit; font:inherit; font-weight:400;
      }
      .deeptutor-settings .config-input::placeholder { color:inherit; opacity:.55; }
      .deeptutor-settings .config-input:focus {
        border-color:#3b82f6; outline:2px solid #3b82f6; outline-offset:1px;
      }
      .deeptutor-settings .config-actions { display:flex; flex-wrap:wrap; gap:8px; }
      .deeptutor-settings .config-actions button {
        padding:8px 14px; border:1px solid #8a8a8a; border-radius:6px;
        background:rgba(127,127,127,.06); color:inherit; font:inherit; cursor:pointer;
      }
      .deeptutor-settings .config-actions button:first-child { background:#2563eb; border-color:#2563eb; color:#fff; }
      .deeptutor-settings .config-actions button:focus-visible { outline:2px solid #3b82f6; outline-offset:2px; }
    `}</style>
    <h2>DeepTutor Sync</h2><p>当前知识库 ID：<code>{kb}</code></p>
    <p>将当前知识库的文本、层级、标签和引用同步到你的服务器。图片、PDF 等附件文件不上传。</p>
    <label className="config-field">服务器 URL<input className="config-input" type="url" autoComplete="off" autoCapitalize="none" spellCheck={false} value={url} onChange={e=>setURL(e.target.value)} placeholder="https://notes.example.com"/></label>
    <label className="config-field">配对 sync token<input className="config-input" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={token} onChange={e=>setToken(e.target.value)} placeholder="粘贴服务器生成的 sync token"/></label>
    <p>Token 仅保存在本机插件存储。保持插件地址稳定，否则浏览器本地队列可能无法恢复。</p>
    <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用自动同步</label>
    <p className="config-actions"><button onClick={()=>void save()}>保存配置</button>
      <button onClick={()=>void request('full').catch(e=>setMessage(String(e)))}>重新全量同步</button>{' '}
      <button onClick={()=>void request('retry').catch(e=>setMessage(String(e)))}>检查并重试</button></p>
    <p>{message}</p><pre style={{whiteSpace:'pre-wrap'}}>{status}</pre>
  </main>;
}
renderWidget(Settings);
