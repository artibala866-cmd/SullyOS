import type { Worldbook, WorldbookPosition } from '../types';

/** Pure compatibility adapter for BabyLink's native worldbook JSON; not Tavern JSON. */
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const keywords=(v:unknown):string[]=>[...new Set((Array.isArray(v)?v:typeof v==='string'?v.split(/[,，、\n]/):[])
    .map(x=>typeof x==='string'?x.trim():'').filter(Boolean))];
const bool=(v:unknown,d:boolean)=>typeof v==='boolean'?v:v===1||v==='1'||v==='true'?true:v===0||v==='0'||v==='false'?false:d;
const num=(v:unknown,d:number,min:number,max:number)=>v==null||!Number.isFinite(Number(v))?d:Math.min(max,Math.max(min,Math.round(Number(v))));
type Group={title:string;book:Record<string,any>;entries:Record<string,any>[]};
const entries=(v:Record<string,any>):Record<string,any>[]=>{
    for(const k of ['entries','worldInfo','loreEntries','lorebookEntries']){
        if(Array.isArray(v[k]))return v[k].filter(object);
        if(object(v[k]))return Object.values(v[k]).filter(object);
    }
    return [];
};
const groups=(v:unknown,name:string):Group[]=>{
    if(Array.isArray(v)){
        const rows=v.filter(object);if(!rows.length)return [];
        if(rows.some(x=>entries(x).length))
            return rows.flatMap((x,i)=>groups(x,name+' '+(i+1)));
        return [{title:name,book:{},entries:rows}];
    }
    if(!object(v))return [];
    for(const k of ['worldBooks','worldbooks','books','lorebooks'])
        if(Array.isArray(v[k]))return groups(v[k],name);
    const own=entries(v);
    if(own.length)return [{title:text(v.title)||text(v.name)||name,book:v,entries:own}];
    return Object.entries(v).flatMap(([k,x])=>Array.isArray(x)?groups(x,k):object(x)?groups(x,k):[]);
};
export interface LinkWorldbookImport {recognized:boolean;books:Worldbook[];warnings:string[]}
export const parseLinkWorldbookJson=(raw:unknown,filename:string):LinkWorldbookImport=>{
    const found=groups(raw,filename);
    const recognized=found.some(group=>
        ['scope','enabled','coverImage'].some(k=>k in group.book)||
        group.entries.some(x=>['activation','keys','secondaryKeys','caseSensitive','insertionPosition','enabled'].some(k=>k in x)));
    if(!recognized)return {recognized:false,books:[],warnings:[]};
    if(found.length>256)throw Error('Link 世界书超过 256 本');
    const books:Worldbook[]=[],warnings:string[]=[];let count=0;
    for(const group of found){
        if(group.book.scope&&group.book.scope!=='local'&&!warnings.includes('Link 全局世界书作为普通世界书导入，不会自动修改角色挂载关系'))
            warnings.push('Link 全局世界书作为普通世界书导入，不会自动修改角色挂载关系');
        for(const row of group.entries){
            if(++count>1000)throw Error('Link 世界书条目超过 1000 条');
            const key=keywords(row.keys??row.key??row.keywords);
            const keysecondary=keywords(row.secondaryKeys??row.secondary_keys??row.keysecondary);
            const title=text(row.title)||text(row.comment)||text(row.name)||key[0]||'未命名条目';
            const body=row.content??row.text??row.value??row.prompt??row.message;
            if(body!=null&&typeof body!=='string')throw Error('Link 世界书「'+title+'」正文格式无效');
            const content=text(body);
            if(content.length>200000)throw Error('Link 世界书条目正文过长');
            if(!content&&!key.length)continue;
            const mode=text(row.activation??row.mode).toLowerCase()||
                (bool(row.constant,false)?'constant':bool(row.priority,false)?'priority':'keyword');
            if(!['constant','keyword','priority'].includes(mode))throw Error('Link 世界书激活模式无法识别');
            const after=/after/i.test(String(row.position??row.insertionPosition??''))||row.position===1;
            if(after&&!warnings.some(x=>x.includes('after-chat')))
                warnings.push('Link after-chat 已近似映射至消息末尾，触发时机可能不同');
            if(mode==='priority'&&!warnings.some(x=>x.includes('priority')))
                warnings.push('Link priority 已近似映射至常驻高优先级');
            const probability=num(row.probability,100,0,100),now=Date.now();
            const position:WorldbookPosition=after?4:0;
            const on=bool(group.book.enabled,true)&&!bool(group.book.disable??group.book.disabled,false)
                &&bool(row.enabled,true)&&!bool(row.disable??row.disabled,false);
            books.push({
                id:'wb-link-'+now+'-'+count+'-'+Math.random().toString(36).slice(2,7),
                title,content,category:'BabyLink · '+group.title,createdAt:now,updatedAt:now,
                key,keysecondary,constant:mode!=='keyword',selective:mode==='keyword'&&keysecondary.length>0,
                selectiveLogic:0,position,order:num(row.order??row.insertion_order,100,0,9999)-(mode==='priority'?10000:0),
                depth:after?0:num(row.depth,4,0,999),role:after?0:null,
                scanDepth:999,disable:!on,probability,useProbability:probability<100,
                caseSensitive:bool(row.caseSensitive??row.case_sensitive,false),matchWholeWords:false,
            });
        }
    }
    if(!books.length)throw Error('Link 世界书没有可导入条目');
    return {recognized:true,books,warnings};
};
