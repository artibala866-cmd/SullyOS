/** Report errors in changed Home3D files only, without hiding pre-existing
 * unrelated repo diagnostics. The full-project typecheck remains separate. */
import ts from 'typescript';
import path from 'node:path';
import process from 'node:process';

const checked=[
 'apps/room3d/chibi/furnitureMotion.ts',
 'apps/room3d/chibi/hugMotion.ts',
 'apps/room3d/chibi/intimacyMotion.ts',
 'apps/room3d/chibi/legContactIK.ts',
 'apps/room3d/chibi/motionConstraintPipeline.ts',
 'apps/room3d/chibi/motionTemplates.ts',
 'apps/room3d/chibi/roomWalk.ts',
 'apps/room3d/chibi/selectedSocial.ts',
 'apps/room3d/chibi/standingHeightAdaptation.ts',
 'apps/room3d/chibi/visitor.ts',
 'apps/room3d/chibi/motionTemplates.test.ts',
 'apps/room3d/chibi/motionConstraintPipeline.test.ts',
 'utils/chibiFurnitureMotion.test.ts',
 'utils/chibiRoomWalk.test.ts',
 'utils/chibiMotionRecovery.test.ts',
];
const configPath=ts.findConfigFile(process.cwd(),ts.sys.fileExists,'tsconfig.json');
if(!configPath)throw Error('tsconfig.json missing');
const read=ts.readConfigFile(configPath,ts.sys.readFile);
if(read.error)throw Error(ts.flattenDiagnosticMessageText(read.error.messageText,'\n'));
const parsed=ts.parseJsonConfigFileContent(read.config,ts.sys,path.dirname(configPath));
if(parsed.errors.length)throw Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors,{
 getCanonicalFileName:f=>f,getCurrentDirectory:process.cwd,getNewLine:()=> '\n'
}));
const targets=new Set(checked.map(f=>path.resolve(f)));
const program=ts.createProgram({rootNames:[...targets],options:{...parsed.options,noEmit:true}});
const all=ts.getPreEmitDiagnostics(program);
const own=all.filter(d=>d.file&&targets.has(path.resolve(d.file.fileName)));
const formatHost={getCanonicalFileName:f=>f,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'};
console.log('Home3D targeted TypeScript files: '+checked.length);
console.log('Target file diagnostics: '+own.length);
console.log('Other dependency diagnostics (not treated as passing): '+(all.length-own.length));
if(own.length){
 console.error(ts.formatDiagnostics(own,formatHost));
 process.exitCode=1;
}
