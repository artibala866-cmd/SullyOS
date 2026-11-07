import type { Worldbook, WorldbookPosition } from '../types';

/**
 * BabyLink 1.1.10 WorldBookPage importer compatibility (native JSON, not
 * SillyTavern's uid/key/constant schema). Preserve activation configuration
 * and a stable source key for repeat imports. No source script is executed.
 */
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):string=>typeof v==='string'?v.trim():'';
const keywords=(v:unknown):string[]=>[...new Set((Array.isArray(v)?v:typeof v==='string'?v.split(/[,，、\n]/):[])
    .map(x=>typeof x==='string'?x.trim():'').filter(Boolean))];
const bool=(v:unknown,d:boolean):boolean=>{
    if(typeof v==='boolean')return v;
    if(typeof v==='number')return v!==0;
    if(typeof v==='string'){
        const value=v.trim().toLowerCase();
        if(['true','1','yes','on'].includes(value))return true;
        if(['false','0','no','off'].includes(value))return false;
    }
    return d;
};
const num=(v:unknown,d:number,min:number,max:number):number=>
    v==null||!Number.isFinite(Number(v))?d:Math.min(max,Math.max(min,Math.round(Number(v))));
const entryLike=(v:Record<string,any>):boolean=>
    ['content','text','value','key','keys','keyword','keywords','comment']
        .some(k=>Object.prototype.hasOwnProperty.call(v,k));
const ENTRY_KEYS=['entries','world_info','worldInfo','loreEntries','lorebookEntries'];
const entryRows=(v:unknown):Record<string,any>[]=>Array.isArray(v)?v.filter(object):
    object(v)?Object.values(v).filter(object):[];
const entries=(v:Record<string,any>):Record<string,any>[]=>{
    for(const key of ENTRY_KEYS){
        const rows=entryRows(v[key]);
        if(rows.length)return rows;
    }
    return [];
};
type Group={title:string;book:Record<string,any>;entries:Record<string,any>[]};
const groups=(raw:unknown,filename:string,depth=0):Group[]=>{
    if(depth>5)return [];
    if(Array.isArray(raw)){
        const rows=raw.filter(object);
        if(!rows.length)return [];
        if(rows.some(v=>entries(v).length))
            return rows.flatMap((v,i)=>groups(v,filename+' '+(i+1),depth+1));
        return [{title:filename,book:{title:filename},entries:rows}];
    }
    if(!object(raw))return [];
    for(const key of ['worldBooks','worldbooks','books','lorebooks']){
        if(Array.isArray(raw[key]))return groups(raw[key],filename,depth+1);
    }
    const own=entries(raw);
    if(own.length)return [{title:text(raw.title)||text(raw.name)||filename,book:raw,entries:own}];
    const values=Object.values(raw).filter(object);
    if(values.length&&values.every(entryLike))
        return [{title:filename,book:{title:filename},entries:values}];
    const nested=Object.entries(raw).flatMap(([key,val]):Group[]=>{
        if(Array.isArray(val)){
            const rows=val.filter(object);
            return rows.length?[{title:key,book:{title:key},entries:rows}]:[];
        }
        if(!object(val))return [];
        const ownEntries=entries(val);
        if(ownEntries.length)return [{title:text(val.title)||text(val.name)||key,book:val,entries:ownEntries}];
        return entryLike(val)?[{title:key,book:{title:key},entries:[val]}]:
            groups(val,key,depth+1);
    });
    if(nested.length)return nested;
    // The source Link app supports one book containing only raw content with
    // no explicit entries; it creates a constant "默认条目" in that case.
    const fallback=raw.content??raw.text??raw.value??raw.prompt??raw.message;
    return typeof fallback==='string'&&fallback.trim()
        ?[{title:text(raw.title)||text(raw.name)||filename,book:raw,
            entries:[{id:'default',title:'默认条目',content:fallback,activation:'constant'}]}]:[];
};
const normalizedScope=(v:unknown):string=>{
    const s=text(v).toLowerCase();
    if(['local','character','角色'].includes(s))return 'local';
    if(['global','global-online','online','global_online','global-offline','offline','global_offline'].includes(s))return s;
    return s;
};
export interface LinkWorldbookImport {recognized:boolean;books:Worldbook[];warnings:string[]}
export const parseLinkWorldbookJson=(raw:unknown,filename:string):LinkWorldbookImport=>{
    const found=groups(raw,filename);
    const explicitlyLink=object(raw)&&['worldBooks','worldbooks','lorebooks'].some(k=>Array.isArray(raw[k]));
    // Sully/Tavern worldbooks may contain 'caseSensitive' or 'enabled' too.
    // Those generic flags alone are not a Link signature. When UID and the
    // legacy selectiveLogic/keysecondary flags are present, prefer the
    // existing standard-worldbook parser instead of corrupting semantics.
    const looksStandard=!explicitlyLink && found.some(group=>
        !group.book.scope && group.entries.some(row=>
            ['uid','selectiveLogic','keysecondary','useProbability','matchWholeWords','extensions']
                .some(k=>k in row) && !('activation' in row)));
    if(looksStandard)return {recognized:false,books:[],warnings:[]};
    const recognized=!!explicitlyLink||found.some(group=>
        ['scope','coverImage','cover','avatar'].some(k=>k in group.book) ||
        group.entries.some(row=>['activation','secondaryKeys','caseSensitive','insertionPosition','probabilityWeight']
            .some(k=>k in row)));
    if(!recognized)return {recognized:false,books:[],warnings:[]};
    if(!found.length)throw Error('Link 世界书没有任何可识别的条目');
    if(found.length>256)throw Error('Link 世界书超过 256 本');
    const books:Worldbook[]=[],warnings:string[]=[],sourceKeys=new Set<string>();
    let count=0;
    for(const group of found){
        const sourceBookId=text(group.book.id);
        const scope=normalizedScope(group.book.scope??group.book.type);
        if(scope&&scope!=='local'&&!warnings.some(x=>x.includes('全局世界书')))
            warnings.push('Link 全局世界书已作为普通世界书导入，未改变任何角色挂载关系');
        for(const row of group.entries){
            if(++count>1000)throw Error('Link 世界书条目超过 1000 条');
            const key=keywords(row.keys??row.key??row.keyword??row.keywords);
            const keysecondary=keywords(row.secondaryKeys??row.secondary_keys??row.keysecondary??row.secondary);
            if(key.length>100||keysecondary.length>100)throw Error('Link 世界书关键词数量超过限制');
            const title=text(row.title)||text(row.comment)||text(row.name)||text(row.memo)||text(row.note)||
                key.join('、')||'条目 '+count;
            const body=row.content??row.text??row.value??row.prompt??row.message;
            if(body!=null&&typeof body!=='string')throw Error('Link 世界书「'+title+'」正文格式无效');
            // Preserve Markdown and whitespace exactly, including leading
            // newlines; never sanitize a user's story text into different data.
            const content=typeof body==='string'?body:'';
            if(content.length>200000)throw Error('Link 世界书条目正文过长');
            if(!content.trim()&&!key.length&&!keysecondary.length){
                if(!warnings.some(x=>x.includes('空白条目')))warnings.push('Link 世界书中仅有标题的空白条目已跳过，没有把空白文本注入角色上下文');
                continue;
            }
            const rawMode=text(row.activation??row.mode).toLowerCase();
            const mode=['constant','keyword','priority'].includes(rawMode)?rawMode:
                bool(row.constant,false)?'constant':bool(row.priority,false)?'priority':'keyword';
            if(rawMode&&!['constant','keyword','priority'].includes(rawMode))
                throw Error('Link 世界书激活模式无法识别：'+rawMode);
            const place=String(row.position??row.insertionPosition??'').toLowerCase();
            const after=place.includes('after')||place==='1';
            if(after&&!warnings.some(x=>x.includes('after-chat')))
                warnings.push('Link after-chat 已近似映射至消息末尾，插入时机可能不同');
            if(mode==='priority'&&!warnings.some(x=>x.includes('priority')))
                warnings.push('Link priority 已近似映射至常驻高优先级');
            const probability=num(row.probability??row.probabilityWeight??row.probability_percent,100,0,100);
            const timestamp=Date.now(), position:WorldbookPosition=after?4:0;
            const enabled=bool(group.book.enabled,!bool(group.book.disable??group.book.disabled,false)) &&
                !bool(group.book.disable??group.book.disabled,false) &&
                bool(row.enabled,!bool(row.disable??row.disabled,false)) &&
                !bool(row.disable??row.disabled,false);
            const entryId=text(row.id);
            const cardImportKey=sourceBookId&&entryId
                ?'babylink-worldbook:'+sourceBookId+':'+entryId:undefined;
            if(cardImportKey){
                if(sourceKeys.has(cardImportKey))throw Error('Link 世界书同一来源含重复条目 ID，不能安全合并');
                sourceKeys.add(cardImportKey);
            }
            books.push({
                id:'wb-link-'+timestamp+'-'+count+'-'+Math.random().toString(36).slice(2,7),
                title,content,category:'BabyLink · '+group.title,
                createdAt:timestamp,updatedAt:timestamp,
                ...(cardImportKey?{cardImportKey}:{}),
                key,keysecondary,constant:mode!=='keyword',
                selective:mode==='keyword'&&keysecondary.length>0,selectiveLogic:0,
                position,order:num(row.order??row.insertion_order??row.priority,100+(count-1)*10,0,9999)-
                    (mode==='priority'?10000:0),
                depth:after?0:num(row.depth??row.scanDepth??row.scan_depth,4,0,999),
                role:after?0:null,scanDepth:999,
                disable:!enabled,probability,useProbability:probability<100,
                caseSensitive:bool(row.caseSensitive??row.case_sensitive,false),
                matchWholeWords:false,
            });
        }
    }
    if(!books.length)throw Error('Link 世界书没有可导入条目');
    return {recognized:true,books,warnings};
};
