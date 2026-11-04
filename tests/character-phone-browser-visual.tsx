import React from 'react';
import {createRoot} from 'react-dom/client';
import CharacterPhoneBrowser from '../components/chat/CharacterPhoneBrowser';
import {clearPhoneBrowserHistory,recordPhoneBrowserNavigation,resolvePhoneBrowserNavigation} from '../utils/characterPhoneBrowser';
import type {CharacterProfile,UserProfile} from '../types';

const id='browser-visual-'+(new URLSearchParams(location.search).get('view')||'list');
clearPhoneBrowserHistory(id);
function seed(query:string,title:string,summary:string,reason:string,thought:string){
 const nav=resolvePhoneBrowserNavigation(query);
 if(nav)recordPhoneBrowserNavigation(id,nav,'char',{title,summary,aiJudgement:reason,
 afterSearchThought:thought,mood:'好奇又有点着急',origin:'ai-generated'});
}
seed('回声线 调调人体课 价格 口碑','查调调人体课底细与行情',
 '想知道人体课值不值，有没有适合新手的课程','她为了单主连着赶稿，最近又想练习人体比例',
 '价格也许不是唯一的问题，还是得先看看课纲和老师的示范再决定。');
seed('冷藏曲奇面团直接烤还是回温','冷藏曲奇面团烘烤处理',
 '弄清黄油曲奇冷藏后要不要回温，烤箱预热温度怎么调','刚才跟妹妹说去烤前两天冰箱里剩下的半盒曲奇',
 '唔，可能得先试一小盘。室温放太久好像也不合适，具体要打开网页确认。');
seed('PS5 单机冒险游戏 通关时长','周末玩什么单机游戏',
 '想找两三款周末能通关的剧情向单机游戏','想给朋友推荐可以周末一起讨论的游戏',
 '原来得优先考虑通关时间，不然一周没空玩会很容易忘掉剧情。');

const view=new URLSearchParams(location.search).get('view')||'list';
createRoot(document.getElementById('root')!).render(
 <div style={{width:'390px',maxWidth:'100vw',height:'900px',background:'#f5f7fb',overflowY:'auto'}}>
  <div style={{height:54,background:'#ededed',display:'flex',alignItems:'center',justifyContent:'center',
   borderBottom:'1px solid #ddd',fontWeight:600,fontSize:21}}>浏览器</div>
  <CharacterPhoneBrowser characterId={id} char={{id,name:'宝宝狗'} as CharacterProfile}
   userProfile={{name:'妹妹'} as UserProfile} groups={[]} api={{baseUrl:'',apiKey:'',model:''}}/>
 </div>
);
setTimeout(()=>{
  if(view==='detail'){
   const btn=document.querySelector<HTMLButtonElement>('[aria-label^="查看浏览记录详情"]');
   btn?.click();
  }
  setTimeout(()=>{
   const cards=document.querySelectorAll('[aria-label^="查看浏览记录详情"]');
   const detail=document.body.textContent?.includes('搜完后的心声')||false;
   const ready=(view==='list' && cards.length>=2)||(view==='detail' && detail);
   document.getElementById('browser-visual-status')!.textContent=JSON.stringify({ready,view,cards:cards.length,detail});
   document.body.dataset.ready=String(ready);
  },500);
},1000);
