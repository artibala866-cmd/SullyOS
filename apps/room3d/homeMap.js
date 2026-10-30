import {interactionIcon} from './interactionIcons.js';
// Floors keep integer navigation cells; the six-room facade is centered per floor.
export function homeDisplayX(home,room){
 const rows=[0,1,2].map(level=>home.rooms.filter(r=>r.level===level));
 const pyramid=home.rooms.length===6&&rows.every((rs,i)=>rs.length===3-i)&&home.rooms.every(r=>r.z===home.rooms[0].z)&&rows.every(rs=>Math.max(...rs.map(r=>r.x))-Math.min(...rs.map(r=>r.x))===rs.length-1);
 if(!pyramid)return room.x;
 const row=rows[room.level],base=rows[0];
 return room.x-(Math.min(...row.map(r=>r.x))+Math.max(...row.map(r=>r.x)))/2+(Math.min(...base.map(r=>r.x))+Math.max(...base.map(r=>r.x)))/2;
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function homeMap(home,residentRoom,collapsed=false){
 const mainRooms=home.rooms.filter(r=>!r.activityRoom),rooms=mainRooms.length?mainRooms:home.rooms;
 const annex=home.rooms.find(r=>r.activityRoom==='halloween'),layoutHome={...home,rooms};
 const minX=Math.min(...rooms.map(r=>r.x)),minZ=Math.min(...rooms.map(r=>r.z));
 const width=Math.max(...rooms.map(r=>r.x))-minX+1,depth=Math.max(...rooms.map(r=>r.z))-minZ+1,top=Math.max(...rooms.map(r=>r.level));
 // The seasonal annex gets a separate tile, preserving the main house's map proportions.
 const annexAction=collapsed?'':annex
  ?'<button class="h3-map-annex" data-action="activity-room" data-value="halloween" aria-label="前往'+escape(annex.name)+'"><span aria-hidden="true">🎃</span><strong>'+String(home.rooms.indexOf(annex)+1)+' · '+escape(annex.name)+'</strong></button>'
  :'<button class="h3-map-annex h3-map-annex-create" data-action="activity-room" data-value="halloween" aria-label="开放万圣节活动小屋，保留现有房间"><span aria-hidden="true">🎃</span><strong>开放万圣节小屋</strong></button>';
 return `<nav class="h3-home-map" data-collapsed="${collapsed}" aria-label="小屋平面图"><button class="h3-map-heading" data-action="map-toggle" aria-label="${collapsed?'展开':'收起'}小屋平面图" aria-expanded="${!collapsed}">${interactionIcon('rooms')}<span>我的家</span><b aria-hidden="true">${collapsed?'＋':'−'}</b></button><div ${collapsed?'hidden':''} style="${collapsed?'display:none;':''}grid-template-columns:repeat(${width*2},minmax(0,1fr))">${rooms.map((r,i)=>`<button data-action="room" data-id="${escape(r.id)}" aria-label="进入${escape(r.name)}" ${r.id===home.activeRoomId?'aria-current="location"':''} style="grid-column:${Math.round((homeDisplayX(layoutHome,r)-minX)*2)+1} / span 2;grid-row:${(top-r.level)*depth+r.z-minZ+1};--room-color:${/^#[0-9a-f]{6}$/i.test(r.wall)?r.wall:'#eee'}"><small>${i+1}</small><strong>${escape(r.name)}</strong>${r.id===home.activeRoomId?'<i aria-label="你在这里"></i>':''}${r.id===residentRoom?'<em class="h3-room-star" role="img" aria-label="角色在这里"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 Q17 3 20 10 L28 11 Q30 12 28 14 L22 20 L23 28 Q23 30 20 28 L16 25 L9 29 Q7 30 8 26 L9 20 L3 14 Q1 12 5 11 L12 10 L15 4Z" fill="#f6cf69" stroke="#fffbed" stroke-width="2.5" stroke-linejoin="round"/><g fill="#88602f"><ellipse cx="12" cy="17" rx="1" ry="1.4"/><ellipse cx="20" cy="17" rx="1" ry="1.4"/></g><path d="M14 20 Q16 22 18 20" fill="none" stroke="#88602f" stroke-width="1.3" stroke-linecap="round"/></svg></em>':''}</button>`).join('')}</div>${annexAction}</nav>`;
}
