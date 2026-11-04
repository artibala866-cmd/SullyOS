import React, {useRef,useState} from 'react';
function MomentsRefreshAperture({loading,angle}:{loading:boolean;angle:number}){
  // Eight shutter blades with a transparent center, matching the WeChat Moments wheel.
  return <span className={loading?'inline-flex animate-spin':'inline-flex'}
    style={{width:46,height:46,transform:loading?undefined:'rotate('+angle+'deg)',transformOrigin:'center'}}>
    <svg data-testid="moments-refresh-aperture" role="img" aria-label="朋友圈刷新中"
      width="46" height="46" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#fff" strokeWidth="2" strokeLinejoin="round">
        <path d="M 24 2.7 A 21.3 21.3 0 0 1 39.06 8.94 L 30.95 20.46 A 7.8 7.8 0 0 0 26.41 16.58 Z" fill="#EE666E"/>
        <path d="M 39.06 8.94 A 21.3 21.3 0 0 1 45.3 24 L 31.42 26.41 A 7.8 7.8 0 0 0 30.95 20.46 Z" fill="#6754D8"/>
        <path d="M 45.3 24 A 21.3 21.3 0 0 1 39.06 39.06 L 27.54 30.95 A 7.8 7.8 0 0 0 31.42 26.41 Z" fill="#38A8E2"/>
        <path d="M 39.06 39.06 A 21.3 21.3 0 0 1 24 45.3 L 21.59 31.42 A 7.8 7.8 0 0 0 27.54 30.95 Z" fill="#3FCACA"/>
        <path d="M 24 45.3 A 21.3 21.3 0 0 1 8.94 39.06 L 17.05 27.54 A 7.8 7.8 0 0 0 21.59 31.42 Z" fill="#4BD560"/>
        <path d="M 8.94 39.06 A 21.3 21.3 0 0 1 2.7 24 L 16.58 21.59 A 7.8 7.8 0 0 0 17.05 27.54 Z" fill="#A2E03D"/>
        <path d="M 2.7 24 A 21.3 21.3 0 0 1 8.94 8.94 L 20.46 17.05 A 7.8 7.8 0 0 0 16.58 21.59 Z" fill="#E5DB44"/>
        <path d="M 8.94 8.94 A 21.3 21.3 0 0 1 24 2.7 L 26.41 16.58 A 7.8 7.8 0 0 0 20.46 17.05 Z" fill="#FFCA24"/>
      </g>
      <circle cx="24" cy="24" r="7.65" stroke="#fff" strokeWidth="1.7"/>
      <circle cx="24" cy="24" r="21.3" stroke="#fff" strokeWidth="1.4"/>
    </svg>
  </span>;
}

export default function PullToRefresh({children,onRefresh,loading}:{children:React.ReactNode;onRefresh:()=>Promise<void>;loading:boolean}) {
  const start=useRef<number|null>(null);
  const [distance,setDistance]=useState(0);
  const pull=(value:number)=>setDistance(Math.min(112,Math.max(0,value)*0.48));
  return <div className="min-h-full touch-pan-y" onTouchStart={e=>{const scroll=e.currentTarget.closest('main');start.current=(e.target as HTMLElement).closest('[data-moments-cover]')?null:scroll?.scrollTop===0?e.touches[0].clientY:null;}} onTouchMove={e=>{if(start.current!==null)pull(e.touches[0].clientY-start.current);}} onTouchCancel={()=>{start.current=null;setDistance(0);}} onTouchEnd={e=>{const d=start.current===null?0:e.changedTouches[0].clientY-start.current;start.current=null;setDistance(0);if(d>85&&!loading)void onRefresh();}}>
    <div className="relative" style={{transform:'translateY('+distance+'px)',transition:distance?'none':'transform 280ms cubic-bezier(.2,.8,.2,1)'}}>
      <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center justify-start pl-7"
        style={{height:64,top:loading&&distance===0?8:-64,
          opacity:loading||distance>8?1:0,transition:'opacity 160ms'}}>
        <MomentsRefreshAperture loading={loading} angle={distance*5}/>
      </div>
      {children}
    </div>
  </div>;
}
