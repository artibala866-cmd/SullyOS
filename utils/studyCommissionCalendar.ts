import type {Commission} from './sullyWorkspace';

export type CommissionCalendarEvent={id:string;date:string;kind:'plan'|'deadline';title:string;stage:string;status:Commission['status'];priority:number};
const dateRx=/^\d{4}-\d{2}-\d{2}$/;
export function validCalendarDate(value:unknown):value is string {
  if(typeof value!=='string'||!dateRx.test(value))return false;
  const date=new Date(value+'T00:00:00.000Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function calendarMonthGrid(year:number,month:number):Array<{date:string;inMonth:boolean}>{
  if(!Number.isInteger(year)||year<1900||year>2200||!Number.isInteger(month)||month<0||month>11)return [];
  const first=new Date(Date.UTC(year,month,1));
  const firstWeekday=first.getUTCDay();
  const total=Math.ceil((firstWeekday+new Date(Date.UTC(year,month+1,0)).getUTCDate())/7)*7;
  return Array.from({length:total},(_,i)=>{
    const day=new Date(Date.UTC(year,month,1-firstWeekday+i));
    return {date:day.toISOString().slice(0,10),inMonth:day.getUTCMonth()===month};
  });
}
export function commissionCalendarEvents(commissions:readonly Commission[]):CommissionCalendarEvent[]{
  const events:CommissionCalendarEvent[]=[];
  for(const c of commissions){
    if(!c || c.status==='archived'||c.status==='cancelled')continue;
    if(validCalendarDate(c.plannedDate))events.push({
      id:c.id,date:c.plannedDate,kind:'plan',title:c.title,stage:c.stage,status:c.status,priority:c.priority,
    });
    if(validCalendarDate(c.dueDate))events.push({
      id:c.id,date:c.dueDate,kind:'deadline',title:c.title,stage:c.stage,status:c.status,priority:c.priority,
    });
  }
  return events.sort((a,b)=>a.date.localeCompare(b.date)||Number(b.kind==='deadline')-Number(a.kind==='deadline')
    ||a.priority-b.priority||a.title.localeCompare(b.title));
}
/** Keep date-less work visible. Calendar cells cannot show work without a date. */
export function undatedCommissionItems(commissions:readonly Commission[]):Commission[]{
  return commissions.filter(c=>c && !['archived','cancelled','delivered'].includes(c.status)
    && !validCalendarDate(c.plannedDate) && !validCalendarDate(c.dueDate));
}
export function commissionCalendarSummary(commissions:readonly Commission[],today:string){
  const active=commissions.filter(c=>c.status==='active').length;
  const finished=commissions.filter(c=>c.status==='delivered').length;
  const upcoming=commissions.filter(c=>c.status==='active' && validCalendarDate(c.dueDate)
    && c.dueDate>=today && c.dueDate<=datePlusDays(today,7)).length;
  const late=commissions.filter(c=>c.status==='active' && validCalendarDate(c.dueDate)
    && c.dueDate<today).length;
  return {active,finished,upcoming,late};
}
function datePlusDays(value:string,offset:number):string{
  const d=new Date(value+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+offset);
  return d.toISOString().slice(0,10);
}
