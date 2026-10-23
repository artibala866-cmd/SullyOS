import React, {useRef,useState} from 'react';
export default function PullToRefresh({children,onRefresh,loading}:{children:React.ReactNode;onRefresh:()=>Promise<void>;loading:boolean}) {
  const start=useRef<number|null>(null);
  const [distance,setDistance]=useState(0);
  const pull=(value:number)=>setDistance(Math.min(112,Math.max(0,value)*0.48));
  return <div className="min-h-full touch-pan-y" onTouchStart={e=>{const scroll=e.currentTarget.closest('main');start.current=scroll?.scrollTop===0?e.touches[0].clientY:null;}} onTouchMove={e=>{if(start.current!==null)pull(e.touches[0].clientY-start.current);}} onTouchCancel={()=>{start.current=null;setDistance(0);}} onTouchEnd={e=>{const d=start.current===null?0:e.changedTouches[0].clientY-start.current;start.current=null;setDistance(0);if(d>85&&!loading)void onRefresh();}}>
    <div className="relative" style={{transform:'translateY('+distance+'px)',transition:distance?'none':'transform 280ms cubic-bezier(.2,.8,.2,1)'}}>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-start pl-7" style={{height:64,transform:'translateY(-100%)',opacity:loading||distance>8?1:0,transition:'opacity 160ms'}}>
        <span aria-label="朋友圈刷新中" className={loading?'animate-spin':''} style={{fontSize:26,background:'conic-gradient(red,orange,yellow,green,cyan,blue,violet,red)',WebkitBackgroundClip:'text',color:'transparent',display:'inline-block',transform:loading?undefined:'rotate('+distance*5+'deg)'}}>◉</span>
      </div>
      {children}
    </div>
  </div>;
}
