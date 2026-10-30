import PhotoLookLibrary from './PhotoFilterPresets';
import PhotoLetteringControls from './PhotoLetteringControls';
import {defaultPhotoLettering,loadPhotoFont,readPhotoLettering,writePhotoLettering,type PhotoLettering} from './photoLettering';
import {composePhoto,photoCaptureAspect,photoWindows,isPhotoPaper} from './photoComposition';
import {PhotoActions} from './PhotoActions';
import React,{useEffect,useRef,useState} from 'react';
import {Camera,X,DownloadSimple,ArrowCounterClockwise} from '@phosphor-icons/react';
import type {HomeEditor} from './editor';
import {photoLooks,type PhotoLook} from './photoEffects';
import {shareOrDownloadBlob} from '../../utils/shareExport';
import './homePhoto.css';
import {photoFrames,photoSize,photoDrag,type PhotoFrame} from './photoFrame';

type PhotoFace=Parameters<HomeEditor['setPhotoFace']>[1];
const expressions={original:'原表情',neutral:'自然',smile:'微笑',happy:'开心',closed:'闭眼笑',surprised:'惊讶'} as const;
const names={natural:'原片',neon:'霓虹失眠',dream:'粉蓝梦游',afterglow:'末班余光',watercolor:'夏日手绘',daylight:'晴空物语'};
export default function HomePhotoMode({editor,onClose}:{editor:HomeEditor;onClose:()=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),[actors,setActors]=useState<Array<{id:string;label:string}>>([]),[actor,setActor]=useState('');
 const [tab,setTab]=useState('氛围'),[look,setLook]=useState<PhotoLook>({...photoLooks.daylight}),[camera,setCamera]=useState({yaw:0,pitch:4,zoom:1,height:1.2,pan:0});
 const [gap,setGap]=useState(.85),[poses,setPoses]=useState<Record<string,{motion:string;time:number;turn:number}>>({}),[revision,refresh]=useState(0),[shot,setShot]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false),[capturing,setCapturing]=useState(false),[hidden,setHidden]=useState(false);
 const [compactActions,setCompactActions]=useState(false);
 const shell=useRef<HTMLDivElement>(null),[bounds,setBounds]=useState({w:0,h:0}),[sideways,setSideways]=useState(false);
 const [format,setFormat]=useState<PhotoFrame>('landscape'),[grid,setGrid]=useState(false),[moving,setMoving]=useState(false);
 const [letteringLibrary,setLetteringLibrary]=useState(readPhotoLettering);
 const lettering=letteringLibrary[format]||defaultPhotoLettering(format);
 const changeLettering=(value:PhotoLettering)=>{const next={...letteringLibrary,[format]:value};setLetteringLibrary(next);try{writePhotoLettering(next);}catch{setError('文字已应用，但未能记住，下次需要重新设置');}};
 const previewSource=useRef<HTMLCanvasElement>();
 const settle=useRef<ReturnType<typeof setTimeout>>();
 const rotated=sideways&&bounds.h>bounds.w,viewW=rotated?bounds.h:bounds.w,viewH=rotated?bounds.w:bounds.h,aspect=photoFrames[format].aspect;
 const sidePanel=viewW>=800||viewW>viewH,availableW=Math.max(1,viewW-(sidePanel&&!hidden?(viewH<520?310:380):24)),availableH=Math.max(1,viewH-(sidePanel||hidden?156:400));
 const frameW=Math.min(availableW,availableH*aspect),frameH=frameW/aspect;
 const frameStyle={width:frameW,height:frameH,left:sidePanel?12+(availableW-frameW)/2:(viewW-frameW)/2,top:sidePanel||hidden?68+(availableH-frameH)/2:78+(availableH-frameH)/3};
 const [faces,setFaces]=useState<Record<string,PhotoFace>>({});
 const face=faces[actor]||{};
 const changeFace=(value:PhotoFace)=>{setFaces(prev=>({...prev,[actor]:{...prev[actor],...value}}));editor.setPhotoFace(actor,value);refresh(n=>n+1);};
 const [dragMode,setDragMode]=useState<'orbit'|'pan'>('orbit');
 const [original,setOriginal]=useState(false);
 const cameraRef=useRef(camera);cameraRef.current=camera;const pointers=useRef(new Map<number,{x:number;y:number}>());
 const shotRef=useRef(''),alive=useRef(true),captureVersion=useRef(0),capturingRef=useRef(false);
 useEffect(()=>{alive.current=true;const a=editor.beginPhotoMode();setActors(a);setActor(a[0]?.id||'');editor.setPhotoCamera(camera);refresh(n=>n+1);return()=>{alive.current=false;captureVersion.current++;editor.endPhotoMode();if(shotRef.current)URL.revokeObjectURL(shotRef.current);};},[editor]);
 useEffect(()=>{const frame=requestAnimationFrame(()=>{if(canvas.current)try{
  const quality=moving?'moving':'preview';
  if(isPhotoPaper(format)){
   const source=previewSource.current ||= document.createElement('canvas');
   editor.renderPhoto(source,original?photoLooks.natural:look,{aspect:photoCaptureAspect(format),quality});
   composePhoto(source,canvas.current,format,quality,lettering);
  }else editor.renderPhoto(canvas.current,original?photoLooks.natural:look,{aspect,quality});
 }catch{setError('取景暂时失败，请调整镜头重试');}});return()=>cancelAnimationFrame(frame);},[editor,look,camera,revision,original,aspect,moving,format,letteringLibrary]);
 useEffect(()=>{if(!isPhotoPaper(format))return;let active=true;loadPhotoFont(lettering).then(()=>{if(active)refresh(n=>n+1);}).catch(()=>{if(active)setError('所选字体未能加载，请换一种字体重试');});return()=>{active=false;};},[format,letteringLibrary]);
 useEffect(()=>editor.subscribePhoto?.(()=>refresh(n=>n+1)),[editor]);
 useEffect(()=>{const element=shell.current;if(!element)return;const measure=()=>setBounds({w:element.clientWidth,h:element.clientHeight});measure();const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(measure):null;observer?.observe(element);return()=>{observer?.disconnect();clearTimeout(settle.current);};},[]);
 useEffect(()=>{const resize=()=>refresh(n=>n+1);window.addEventListener('resize',resize);const esc=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}};window.addEventListener('keydown',esc);return()=>{window.removeEventListener('resize',resize);window.removeEventListener('keydown',esc);};},[onClose]);
 const pose=poses[actor]||{motion:'original',time:1,turn:0};
 const changePose=(v:Partial<typeof pose>)=>{const next={...pose,...v};setPoses(p=>({...p,[actor]:next}));editor.setPhotoTurn(actor,next.turn);refresh(n=>n+1);};
 const movingPreview=()=>{setMoving(true);clearTimeout(settle.current);settle.current=setTimeout(()=>setMoving(false),160);};
 const cameraChange=(key:keyof typeof camera,value:number)=>{movingPreview();const next={...cameraRef.current,[key]:value};cameraRef.current=next;setCamera(next);editor.setPhotoCamera(next);};
 const compose=(pan:number)=>{setFormat('cinema');const next={...cameraRef.current,pan,zoom:pan===0?1:.78,pitch:2,height:1.25};cameraRef.current=next;setCamera(next);editor.setPhotoCamera(next);};
 const moveCamera=(e:React.PointerEvent<HTMLCanvasElement>)=>{const old=pointers.current.get(e.pointerId);if(!old)return;const next={x:e.clientX,y:e.clientY},delta=photoDrag(next.x-old.x,next.y-old.y,rotated),others=[...pointers.current.entries()].filter(([id])=>id!==e.pointerId);let c={...cameraRef.current};if(others.length){const other=others[0][1],before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(next.x-other.x,next.y-other.y);if(before>1)c.zoom=Math.max(.4,Math.min(3,c.zoom*after/before));}else if(dragMode==='pan'){c.pan=Math.max(-5,Math.min(5,c.pan-delta.dx*.012/c.zoom));c.height=Math.max(.2,Math.min(3,c.height+delta.dy*.008/c.zoom));}else{c.yaw=((c.yaw-delta.dx*.35+540)%360)-180;c.pitch=Math.max(-20,Math.min(55,c.pitch+delta.dy*.2));}pointers.current.set(e.pointerId,next);movingPreview();cameraRef.current=c;setCamera(c);editor.setPhotoCamera(c);};
 const shoot=()=>{
  if(!canvas.current||capturingRef.current)return;
  capturingRef.current=true;
  const version=++captureVersion.current,output=document.createElement('canvas');
  setError('');setCapturing(true);
  const capture=async()=>{
   const source=isPhotoPaper(format)?document.createElement('canvas'):null;
   try{
    if(source){
     await loadPhotoFont(lettering);
     if(!alive.current||version!==captureVersion.current)return;
     editor.renderPhoto(source,original?photoLooks.natural:look,{aspect:photoCaptureAspect(format),quality:'export'});
     const sceneSize=photoSize(photoCaptureAspect(format),'export');
     if(source.width!==sceneSize.width||source.height!==sceneSize.height)throw Error('相纸取景分辨率异常');
     composePhoto(source,output,format,'export',lettering);
    }else editor.renderPhoto(output,original?photoLooks.natural:look,{aspect,quality:'export'});
    const expected=photoSize(aspect,'export');
    if(output.width!==expected.width||output.height!==expected.height)throw Error(`照片分辨率异常：${output.width}×${output.height}`);
    output.toBlob(blob=>{
     output.width=output.height=1;
     if(!alive.current||version!==captureVersion.current)return;
     capturingRef.current=false;setCapturing(false);
     if(!blob){setError('照片生成失败，请重试');return;}
     if(shotRef.current)URL.revokeObjectURL(shotRef.current);
     shotRef.current=URL.createObjectURL(blob);
     setShot(shotRef.current);
    },'image/png');
   }catch(error){
    output.width=output.height=1;
    if(!alive.current||version!==captureVersion.current)return;
    capturingRef.current=false;console.warn('[HomePhoto] Capture failed',error);
    setCapturing(false);setError('照片生成失败，请重试');
   }finally{
    if(source)source.width=source.height=1;
   }
  };
  void capture();
 };
 const retake=()=>{
  captureVersion.current++;capturingRef.current=false;
  if(shotRef.current){URL.revokeObjectURL(shotRef.current);shotRef.current='';}
  setError('');setShot('');setCapturing(false);
 };
 const slider=(label:string,value:number,min:number,max:number,step:number,onChange:(v:number)=>void)=><label className="photo-slider">{label}<input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/><output>{value.toFixed(step<1?2:0)}</output></label>;
 return <div ref={shell} className="photo-shell"><section className="home-photo-mode" data-sideways={rotated} data-wide={sidePanel} data-short={viewH<520} aria-label="合影模式" style={{'--photo-height':`${viewH}px`,...(rotated?{width:bounds.h,height:bounds.w,left:'50%',top:'50%',right:'auto',bottom:'auto',transform:'translate(-50%, -50%) rotate(90deg)'}:{})} as React.CSSProperties}>
  <div className="photo-frame" style={frameStyle}>
  <canvas ref={canvas} className="photo-view" aria-label="照片取景画面" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});}} onPointerMove={moveCamera} onPointerUp={e=>pointers.current.delete(e.pointerId)} onPointerCancel={e=>pointers.current.delete(e.pointerId)} onWheel={e=>{cameraChange('zoom',Math.max(.4,Math.min(3,cameraRef.current.zoom*Math.exp(-e.deltaY*.001))));}}/>
  {grid&&photoWindows(format).map((window,i)=><div key={i} className="photo-thirds" aria-hidden="true" style={{left:window.x*100+'%',top:window.y*100+'%',width:window.w*100+'%',height:window.h*100+'%'}}/>)}<span className="photo-format-label">{photoFrames[format].label}</span></div>
  <header><div><small>HOME / PHOTO</small><strong>把此刻留下</strong></div><button aria-label="退出拍照" onClick={onClose}><X size={22}/></button></header>
  {shot?<div className="photo-result"><img src={shot} alt="拍好的合影"/><div><button disabled={saving} onClick={retake}><ArrowCounterClockwise/>继续拍</button><button disabled={saving} onClick={async()=>{setSaving(true);try{const blob=await (await fetch(shot)).blob();await shareOrDownloadBlob({blob,fileName:'家园合影.png',shareTitle:'家园合影',preferDownloadOnWeb:true});}catch{setError('保存失败，请重试');}finally{if(alive.current)setSaving(false);}}}><DownloadSimple/>保存照片</button></div></div>:<>
   <div className="photo-dock" data-preview={tab==='动作'&&compactActions}><div className="photo-dock-tools"><button onClick={()=>setDragMode(dragMode==='orbit'?'pan':'orbit')}>{dragMode==='orbit'?'拖动：旋转':'拖动：平移'}</button><button aria-pressed={original} onClick={()=>setOriginal(!original)}>{original?'恢复滤镜':'暂看原片'}</button><button className="photo-clean" aria-expanded={!hidden} onClick={()=>setHidden(!hidden)}>{hidden?'显示调节 ↑':'纯净取景 · 收起 ↓'}</button></div>
   <div className="photo-controls" hidden={hidden}><nav hidden={tab==='动作'&&compactActions}>{['镜头','人物','动作','氛围'].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>{setTab(t);setCompactActions(false);}}>{t}</button>)}</nav>
    <div className="photo-settings">
    {tab==='镜头'&&<><div className="photo-options photo-formats" aria-label="照片比例">{Object.entries(photoFrames).map(([id,f])=><button key={id} aria-pressed={format===id} onClick={()=>setFormat(id as PhotoFrame)}>{f.label}</button>)}</div>{isPhotoPaper(format)&&<PhotoLetteringControls value={lettering} onChange={changeLettering} onReset={()=>changeLettering(defaultPhotoLettering(format))}/>}<div className="photo-options" aria-label="留白构图"><button onClick={()=>compose(0)}>居中同框</button><button onClick={()=>compose(-2)}>左侧留白</button><button onClick={()=>compose(2)}>右侧留白</button><button aria-pressed={grid} onClick={()=>setGrid(!grid)}>三分线</button></div>{slider('左右平移',camera.pan,-5,5,.05,v=>cameraChange('pan',v))}{slider('左右环绕',camera.yaw,-180,180,1,v=>cameraChange('yaw',v))}{slider('俯仰',camera.pitch,-20,55,1,v=>cameraChange('pitch',v))}{slider('拉近',camera.zoom,.4,3,.05,v=>cameraChange('zoom',v))}{slider('取景高度',camera.height,.2,3,.05,v=>cameraChange('height',v))}</>}
    {tab==='人物'&&<><div className="photo-options"><button disabled={actors.length<2} onClick={()=>{editor.setPhotoTogether(gap);setPoses({});refresh(n=>n+1);}}>并排合影</button>{actors.map(a=><button key={a.id} aria-pressed={actor===a.id} onClick={()=>setActor(a.id)}>{a.label}</button>)}</div>{actors.length<2&&<p>同房的两个人都在场时，可以并排合影。</p>}{slider('两人间距',gap,.55,2,.05,v=>{setGap(v);editor.setPhotoTogether(v);setPoses({});refresh(n=>n+1);})}{slider('人物转向',pose.turn,-180,180,1,v=>changePose({turn:v}))}<div className="photo-options" aria-label="拍照表情">{Object.entries(expressions).map(([key,label])=><button key={key} aria-pressed={(face.expression||'original')===key} onClick={()=>changeFace({expression:key as NonNullable<PhotoFace['expression']>})}>{label}</button>)}</div><div className="photo-options"><button aria-pressed={face.lookCamera===true} onClick={()=>changeFace({lookCamera:!face.lookCamera})}>看镜头：{face.lookCamera?'开':'关'}</button></div></>}
    <div hidden={tab!=='动作'}><PhotoActions editor={editor} actors={actors} refresh={()=>refresh(n=>n+1)} compact={compactActions} onPreview={()=>setCompactActions(true)} onExpand={()=>setCompactActions(false)}/></div>
    {tab==='氛围'&&<><div className="photo-options photo-presets">{Object.entries(names).map(([key,label])=><button key={key} aria-pressed={look.preset===key} onClick={()=>setLook({...photoLooks[key as PhotoLook['preset']]})}>{label}</button>)}</div>{slider('光晕',look.glow,0,3,.05,v=>setLook({...look,glow:v}))}{slider('色差',look.fringe,0,1,.05,v=>setLook({...look,fringe:v}))}{slider('暗角',look.vignette,0,1,.05,v=>setLook({...look,vignette:v}))}{slider('曝光',look.exposure,.5,1.6,.05,v=>setLook({...look,exposure:v}))}<PhotoLookLibrary look={look} onApply={value=>{setLook(value);setOriginal(false);}}/></>}
    </div></div></div>
   <footer>{bounds.h>bounds.w?<button aria-pressed={rotated} onClick={()=>{pointers.current.clear();setSideways(!sideways);}}>{rotated?'回到竖屏':'横屏取景'}</button>:<span>{dragMode==='orbit'?'拖动画面转镜头':'拖动画面平移取景'}</span>}<button className="photo-shutter" aria-label="拍下合影" disabled={capturing} onClick={shoot}><Camera size={28}/></button><span aria-label="照片导出分辨率">高清 PNG · {photoSize(aspect,'export').width}×{photoSize(aspect,'export').height}</span></footer>
  </>}{error&&<p role="alert" className="photo-error">{error}</p>}
 </section></div>;
}
