import {LoadingManager} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {readPackAsset,resourcePath} from './resourcePacks';

/** Only this model and its texture dependencies are materialized, never the entire pack. */
export async function loadHomeGLTF(url:string,signal?:AbortSignal){
 let local:Awaited<ReturnType<typeof readPackAsset>>;
 try{local=await readPackAsset(url);}catch(error){if(typeof indexedDB!=='undefined')throw error;}
 if(signal?.aborted)throw signal.reason;
 const absolute=new URL(url,typeof location==='undefined'?'https://local.invalid/':location.href),base=new URL('.',absolute).href;
 const manager=new LoadingManager(),urls:string[]=[];
 try{
  if(local){
   const dependencies=new Map<string,string>();
   for(const [path,blob] of local.dependencies){const value=URL.createObjectURL(blob);urls.push(value);dependencies.set(path,value);}
   manager.setURLModifier(request=>dependencies.get(resourcePath(request))??request);
  }
  const loader=new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  let bytes:ArrayBuffer;
  if(local)bytes=await local.blob.arrayBuffer();
  else {const response=await fetch(url,{signal});if(!response.ok)throw new Error('模型加载失败，请重试');bytes=await response.arrayBuffer();}
  if(signal?.aborted)throw signal.reason;
  return await loader.parseAsync(bytes,base);
 }finally{urls.forEach(value=>URL.revokeObjectURL(value));}
}
