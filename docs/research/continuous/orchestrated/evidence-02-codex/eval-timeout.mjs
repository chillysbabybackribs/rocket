import { EvalRuns } from '../../../../../src/host/eval-runs.ts'
import { Hub } from '../../../../../src/host/hub.ts'
import { Store } from '../../../../../src/host/store.ts'
import { EvalExport } from '../../../../../src/host/eval-export.ts'
import { unavailableUsage } from '../../../../../src/host/providers/provider.ts'
import { mkdirSync,mkdtempSync,writeFileSync,rmSync } from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {setTimeout as delay} from 'node:timers/promises'
const dir=mkdtempSync(join(tmpdir(),'rocket-eval-timeout-'))
let stopCalls=0, finish
const adapter={
 id:'codex', prepare:async()=>{}, models:async()=>[], usage:async()=>unavailableUsage('codex','synthetic'), forget:()=>{}, shutdown:()=>{},
 run:async(request,sink)=>{sink.session('synthetic');return new Promise(resolve=>{finish=resolve})},
 stop:async()=>{stopCalls++;finish?.({status:'interrupted'})}
}
const store=new Store(':memory:')
const hub=new Hub(store,{claude:adapter,codex:adapter,cursor:adapter,antigravity:adapter},()=>{})
const fixture=join(dir,'fixture');mkdirSync(fixture);writeFileSync(join(fixture,'README.md'),'Synthetic fixture\n')
const scenario={id:'timeout',file:'fixture.jsonl',cwd:fixture,message:'Synthetic held turn',openGoal:false,graders:['turn_completed'],trials:1,runsAlone:false,matrix:[{provider:'codex',model:null}]}
const runs=new EvalRuns({hub,store,goals:{},evalExport:new EvalExport(dir,dir,()=>store,()=>undefined),timingForChat:()=>undefined,root:join(dir,'eval-live'),scenarios:()=>[scenario],emit:()=>{},providerBusy:provider=>hub.working().some(t=>t.provider===provider),timeoutMs:20})
try{
 const started=runs.start({scenarioId:'timeout'})
 for(let i=0;i<200&&runs.list()[0].status==='running';i++)await delay(10)
 const run=runs.list()[0]
 const result={runStatus:run.status,cellStatus:run.cells[0].status,error:run.cells[0].error,providerTurnsStillRunning:hub.working().length,adapterStopCalls:stopCalls}
 await runs.stop(started.id)
 result.afterEvalStop={providerTurnsStillRunning:hub.working().length,adapterStopCalls:stopCalls}
 writeFileSync(new URL('./eval-timeout.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2))
}finally{
 for(const turn of hub.working())await hub.stop(turn.chatId)
 for(let i=0;i<100&&hub.working().length;i++)await delay(10)
 await hub.shutdown();store.close();rmSync(dir,{recursive:true,force:true})
}
