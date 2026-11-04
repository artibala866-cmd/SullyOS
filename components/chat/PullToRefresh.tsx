import React, {useRef,useState} from 'react';

type PullToRefreshProps = {
  children: React.ReactNode;
  onRefresh: () => Promise<void>;
  loading: boolean;
  /** Keep the Moments feed stationary while the cover image stretches. */
  stretchCover?: boolean;
};

export default function PullToRefresh({children,onRefresh,loading,stretchCover=false}:PullToRefreshProps) {
  const start=useRef<number|null>(null);
  const [distance,setDistance]=useState(0);
  const pull=(value:number)=>setDistance(Math.min(stretchCover?124:112,Math.max(0,value)*(stretchCover?0.55:0.48)));
  const contentStyle=stretchCover
    ? ({'--moments-cover-pull':distance+'px'} as React.CSSProperties)
    : {transform:'translateY('+distance+'px)',transition:distance?'none':'transform 280ms cubic-bezier(.2,.8,.2,1)'};

  return <div className="min-h-full touch-pan-y"
    onTouchStart={e=>{
      const scroll=e.currentTarget.closest('main');
      start.current=scroll?.scrollTop===0?e.touches[0].clientY:null;
    }}
    onTouchMove={e=>{if(start.current!==null)pull(e.touches[0].clientY-start.current);}}
    onTouchCancel={()=>{start.current=null;setDistance(0);}}
    onTouchEnd={e=>{
      const d=start.current===null?0:e.changedTouches[0].clientY-start.current;
      start.current=null;
      setDistance(0);
      // Ordinary pulls stretch the Moments cover only; a deliberate long pull still refreshes.
      if(d>(stretchCover?190:85)&&!loading)void onRefresh();
    }}>
    <div className="relative" style={contentStyle} data-cover-pulling={stretchCover&&distance>0?'true':'false'}>
      <div className={"pointer-events-none absolute inset-x-0 z-10 flex items-center justify-start pl-7 "+(stretchCover?'top-2':'top-0')}
        style={{height:64,transform:stretchCover?'none':'translateY(-100%)',
          opacity:loading||distance>(stretchCover?80:8)?1:0,transition:'opacity 160ms'}}>
        {stretchCover
          ? <span aria-label="朋友圈刷新中" className={loading?'animate-spin':''}
              style={{fontSize:24,color:'#fff',textShadow:'0 1px 5px rgba(0,0,0,.65)'}}>↻</span>
          : <span aria-label="朋友圈刷新中" className={loading?'animate-spin':''}
              style={{fontSize:26,background:'conic-gradient(red,orange,yellow,green,cyan,blue,violet,red)',
                WebkitBackgroundClip:'text',color:'transparent',display:'inline-block',
                transform:loading?undefined:'rotate('+distance*5+'deg)'}}>◉</span>}
      </div>
      {children}
    </div>
  </div>;
}
