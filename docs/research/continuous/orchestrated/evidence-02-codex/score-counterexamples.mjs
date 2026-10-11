import { loadToolEvalScores, loadToolEvalWeights } from '../../../../../src/host/tool-eval-scores.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const root=mkdtempSync(join(tmpdir(),'rocket-score-research-'))
const repo=join(root,'repo'), profile=join(root,'profile')
const tool={name:'probe',description:'Synthetic',inputSchema:{type:'object'},run:()=>({content:[]})}
try {
 mkdirSync(join(repo,'docs/evals/scenarios'),{recursive:true})
 mkdirSync(join(repo,'config'),{recursive:true})
 writeFileSync(join(repo,'docs/evals/scenarios/probe.jsonl'),JSON.stringify({id:'probe-case',targetTool:'probe',cwd:'.',message:'Synthetic',graders:['turn_completed']})+'\n')
 const passed=join(profile,'eval-live/old/cells/probe-case__codex__default__trial0')
 mkdirSync(passed,{recursive:true})
 writeFileSync(join(passed,'graders.json'),JSON.stringify({allPass:true}))
 const failed=join(profile,'eval-live/new')
 mkdirSync(failed,{recursive:true})
 writeFileSync(join(failed,'run.json'),JSON.stringify({scenarioId:'probe-case',status:'done',cells:[{provider:'codex',status:'error',error:'Turn did not finish within 900s',pass:null}]}))
 const score=loadToolEvalScores(undefined,[tool],repo,profile).tools[0]
 writeFileSync(join(repo,'config/tool-eval-weights.json'),JSON.stringify({wR:0,wP:1}))
 const weights=loadToolEvalWeights(repo)
 const result={scoreAfterOnePassAndOneError:score,requestedWeights:{wR:0,wP:1},loadedWeights:weights}
 writeFileSync(new URL('./score-counterexamples.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify(result,null,2))
}finally{rmSync(root,{recursive:true,force:true})}
