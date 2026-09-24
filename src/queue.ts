import {openDB, type IDBPDatabase} from 'idb';
import {type Batch, type State, initialState} from './types';

export class Queue {
  private constructor(readonly db:IDBPDatabase) {}
  static async open(namespace:string) {
    const db = await openDB('rn-deeptutor-v1-'+namespace,1,{upgrade(db){
      db.createObjectStore('meta'); db.createObjectStore('queue',{keyPath:'seq'});
    }});
    return new Queue(db);
  }
  async state():Promise<State> {return await this.db.get('meta','state') ?? initialState();}
  async count():Promise<number> {return this.db.count('queue');}
  async oldest():Promise<Batch|undefined> {return (await this.db.transaction('queue').store.openCursor())?.value;}
  async enqueue(batches:Batch[],state:State) {
    // Queue and scan ledger advance together or not at all, including quota failures.
    const tx=this.db.transaction(['queue','meta'],'readwrite');
    await Promise.all([...batches.map(batch=>tx.objectStore('queue').add(batch)),
      tx.objectStore('meta').put(state,'state'),tx.done]);
  }
  async ack(batch:Batch) {
    const tx=this.db.transaction(['queue','meta'],'readwrite');
    await tx.objectStore('queue').delete(batch.seq);
    await tx.objectStore('meta').delete('retry');
    await tx.done;
  }
  async retry():Promise<{attempts:number;at:number;blocked:boolean}|undefined> {return this.db.get('meta','retry');}
  async failed(blocked:boolean,retryAfterMs=0) {
    const attempts=(await this.retry())?.attempts ?? 0;
    const delay=Math.max(retryAfterMs,Math.min(300_000,1000*2**Math.min(attempts,9))*(0.8+Math.random()*0.4));
    await this.db.put('meta',{attempts:attempts+1,at:Date.now()+delay,blocked},'retry');
  }
  async unblock() {await this.db.delete('meta','retry');}
}
