import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import PullToRefresh from '../components/chat/PullToRefresh';

function Preview(){
 const [loading,setLoading]=useState(false);
 return <div style={{width:'390px',maxWidth:'100vw',height:850,background:'#ededed'}}>
  <div style={{height:34,padding:'7px 18px',fontSize:13}}>15:48 <span style={{float:'right'}}>4G ▮▮▮ 50%</span></div>
  <header style={{height:56,padding:'13px 18px',fontSize:21,textAlign:'center'}}>朋友圈</header>
  <main style={{height:760,overflowY:'auto',background:'#dedee0'}}>
   <PullToRefresh loading={loading} onRefresh={async()=>{setLoading(true);}}>
    <div style={{height:300,background:'linear-gradient(140deg,#c5cad2,#ececf0)',padding:22}}>
     <div style={{height:55}}/><span style={{fontSize:16,color:'#56616e'}}>朋友圈封面</span>
    </div>
    <div style={{height:480,background:'#fff',padding:18}}>宝宝狗　今天的朋友圈动态</div>
   </PullToRefresh>
  </main>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
