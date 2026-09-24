import {AppEvents,declareIndexPlugin,type ReactRNPlugin} from '@remnote/plugin-sdk';
import {SyncEngine} from '../sync';

let engine:SyncEngine|undefined, timer:ReturnType<typeof setInterval>|undefined;
async function onActivate(plugin:ReactRNPlugin){
  engine=new SyncEngine(plugin);
  await plugin.app.registerCommand({id:'rn-sync-settings',name:'DeepTutor Sync: 配置与状态',
    action:()=>plugin.window.openWidgetInPane('settings').then(()=>{})});
  // Payload is intentionally ignored: SDK types describe it as `any`.
  plugin.event.addListener(AppEvents.GlobalRemChanged,undefined,engine.signal);
  timer=setInterval(()=>void engine?.tick(),3000);
}
async function onDeactivate(plugin:ReactRNPlugin){
  if(timer)clearInterval(timer);
  if(engine){plugin.event.removeListener(AppEvents.GlobalRemChanged,undefined,engine.signal);engine.stop();}
}
declareIndexPlugin(onActivate,onDeactivate);
