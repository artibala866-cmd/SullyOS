/** Compare TypeScript diagnostics in changed Home3D files against the exact
 * pre-recovery Git baseline. Existing repository errors remain visible, but
 * only NEW diagnostics can make this incremental recovery gate fail. */
import ts from 'typescript';
import path from 'node:path';
import process from 'node:process';
import {execFileSync} from 'node:child_process';

const checked=[
 'apps/room3d/chibi/furnitureMotion.ts',
 'apps/room3d/chibi/hugMotion.ts',
 'apps/room3d/chibi/intimacyMotion.ts',
 'apps/room3d/chibi/legContactIK.ts',
 'apps/room3d/chibi/motionConstraintPipeline.ts',
 'apps/room3d/chibi/motionTemplates.ts',
 'apps/room3d/chibi/motionTemplateScope.ts',
 'apps/room3d/chibi/roomWalk.ts',
 'apps/room3d/chibi/selectedSocial.ts',
 'apps/room3d/chibi/socialContact.ts',
 'apps/room3d/chibi/standingHeightAdaptation.ts',
 'apps/room3d/chibi/visitor.ts',
 'apps/room3d/chibi/motionTemplates.test.ts',
 'apps/room3d/chibi/motionConstraintPipeline.test.ts',
 'utils/chibiFurnitureMotion.test.ts',
 'utils/chibiRoomWalk.test.ts',
 'utils/chibiMotionRecovery.test.ts',
];
const baselineRef='refs/remotes/origin/feat/amaama-unity-retarget-probe';
const cwd=process.cwd();
const configPath=ts.findConfigFile(cwd,ts.sys.fileExists,'tsconfig.json');
if(!configPath)throw Error('tsconfig.json missing');
const config=ts.readConfigFile(configPath,ts.sys.readFile);
if(config.error)throw Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\n'));
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,path.dirname(configPath));
if(parsed.errors.length)throw Error('Invalid tsconfig: '+parsed.errors.length+' diagnostics');
const oldFiles=new Map();
for(const file of checked){
 try{
  oldFiles.set(path.resolve(file),execFileSync('git',['show',`${baselineRef}:${file}`],{cwd,encoding:'utf8'}));
 }catch(e){
  if(file!=='utils/chibiMotionRecovery.test.ts')throw Error('Baseline source unavailable for '+file+' ('+String(e).slice(0,80)+')');
 }
}
const paths=new Set(checked.map(file=>path.resolve(file)));
const baselinePaths=[...oldFiles.keys()];
const currentPaths=[...paths];
const extract=(override,roots)=>{
 const host=ts.createCompilerHost({...parsed.options,noEmit:true});
 if(override){
  const read=host.readFile.bind(host);
  host.readFile=(file)=>oldFiles.get(path.resolve(file))??read(file);
 }
 const program=ts.createProgram({rootNames:roots,options:{...parsed.options,noEmit:true},host});
 const all=ts.getPreEmitDiagnostics(program);
 return {
  target:all.filter(d=>d.file&&paths.has(path.resolve(d.file.fileName))),
  other:all.filter(d=>!d.file||!paths.has(path.resolve(d.file.fileName))),
 };
};
const baseline=extract(true,baselinePaths);
const current=extract(false,currentPaths);
const key=(d)=>[
 path.relative(cwd,d.file?.fileName??'<global>'),
 d.code,
 ts.flattenDiagnosticMessageText(d.messageText,' ').replace(/\s+/g,' ').trim(),
].join('|');
const allowances=new Map();
for(const d of baseline.target){const k=key(d);allowances.set(k,(allowances.get(k)||0)+1);}
const newErrors=[];
for(const d of current.target){
 const k=key(d),remaining=allowances.get(k)||0;
 if(remaining)allowances.set(k,remaining-1);
 else newErrors.push(d);
}
const matched=current.target.length-newErrors.length;
console.log('Home3D TypeScript baseline: '+baselineRef);
console.log('Changed TS files: '+checked.length+' (new files: '+(checked.length-oldFiles.size)+')');
console.log('Baseline target diagnostics: '+baseline.target.length);
console.log('Current target diagnostics: '+current.target.length);
console.log('Pre-existing target diagnostics matched: '+matched);
console.log('NEW target diagnostics: '+newErrors.length);
console.log('Other current dependency diagnostics: '+current.other.length+' (not asserted clean)');
if(newErrors.length){
 const formatHost={getCanonicalFileName:f=>f,getCurrentDirectory:()=>cwd,getNewLine:()=> '\n'};
 console.error(ts.formatDiagnostics(newErrors,formatHost));
 process.exitCode=1;
}
