import { describe, expect, it } from 'vitest';
import { parseLinkWorldbookJson } from './linkWorldbookImport';
import { parseStandardWorldbook } from './worldbook';
describe('Link 1.1.10 native worldbook JSON import compatibility',()=>{
    const native={
        worldBooks:[
            {id:'book-a',title:'世界设定',scope:'local',enabled:true,entries:[
                {id:'one',title:'人物秘密',content:'秘密正文',activation:'keyword',keys:['身份','代号'],secondaryKeys:['暗号'],
                    enabled:true,position:'before-chat',caseSensitive:true,probability:66,order:130},
                {id:'two',title:'永久设定',content:'常驻条目',activation:'constant',enabled:false,keys:[],position:'after-chat'},
            ]},
            {id:'book-b',title:'剧情触发',scope:'global',enabled:true,entries:[
                {id:'three',title:'优先条目',content:'重要剧情',activation:'priority',enabled:true},
            ]},
        ],
    };
    it('preserves Link keys, activation, enabled state, priority and book category',()=>{
        const parsed=parseLinkWorldbookJson(native,'导出世界书');
        expect(parsed.recognized).toBe(true);
        expect(parsed.books).toHaveLength(3);
        expect(parsed.books[0]).toMatchObject({
            category:'BabyLink · 世界设定',title:'人物秘密',content:'秘密正文',
            key:['身份','代号'],keysecondary:['暗号'],constant:false,disable:false,
            caseSensitive:true,position:0,probability:66,useProbability:true,scanDepth:999,
        });
        expect(parsed.books[1]).toMatchObject({title:'永久设定',constant:true,disable:true,position:4,depth:0});
        expect(parsed.books[2].category).toBe('BabyLink · 剧情触发');
        expect(parsed.books[2].order).toBeLessThan(0);
        expect(parsed.warnings.join(' ')).toContain('priority');
        expect(parsed.warnings.join(' ')).toContain('after-chat');
    });
    it('does not hijack standard SillyTavern worldbooks',()=>{
        const standard={entries:{0:{uid:12,comment:'酒馆设定',content:'酒馆正文',key:['信号'],constant:false}}};
        expect(parseLinkWorldbookJson(standard,'酒馆').recognized).toBe(false);
        expect(parseStandardWorldbook(JSON.stringify(standard),'酒馆')).toHaveLength(1);
    });
    it('recognizes Link named collection of entry groups and skips empty rows',()=>{
        const json={设定A:[{title:'A',content:'A内容',activation:'constant'}],
            设定B:[{title:'B',content:'B内容',keys:['B'],activation:'keyword'},
                {title:'空白',content:'',keys:[]}]};
        const result=parseLinkWorldbookJson(json,'集合');
        expect(result.books.map(x=>x.title)).toEqual(['A','B']);
        expect(result.books.map(x=>x.category)).toEqual(['BabyLink · 设定A','BabyLink · 设定B']);
    });
    it('matches the APK world_info, keyword aliases, full-text book and global scopes',()=>{
        const payload={
            worldBooks:[
                {id:'book-source-A',title:'长篇故事',scope:'global-online',enabled:true,
                    world_info:{
                        a:{id:'entry-A',memo:'人物关系',text:'\n剧情正文\n',mode:'keyword',
                            keyword:'旧友，重逢',secondary:'雨天',insertionPosition:'after-chat',
                            probability_percent:42,case_sensitive:true,scan_depth:9},
                        b:{id:'entry-B',title:'常驻设定',value:'世界背景',constant:true,disabled:true},
                    }},
                {id:'book-source-B',title:'全文书',scope:'local',
                    content:'未拆条目的完整段落\n第二段'},
            ],
        };
        const result=parseLinkWorldbookJson(payload,'混合导出');
        expect(result.recognized).toBe(true);
        expect(result.books).toHaveLength(3);
        expect(result.books[0]).toMatchObject({
            cardImportKey:'babylink-worldbook:book-source-A:entry-A',
            category:'BabyLink · 长篇故事',title:'人物关系',
            content:'\n剧情正文\n',key:['旧友','重逢'],
            keysecondary:['雨天'],position:4,depth:0,
            probability:42,useProbability:true,caseSensitive:true,
        });
        expect(result.books[1].disable).toBe(true);
        expect(result.books[2]).toMatchObject({
            category:'BabyLink · 全文书',title:'默认条目',
            content:'未拆条目的完整段落\n第二段',constant:true,
        });
        expect(result.warnings.join(' ')).toContain('全局');
    });
    it('does not classify a standard Tavern book with enabled/keys alone as Link',()=>{
        const standard={entries:[
            {uid:15,comment:'原生条目',content:'正文',key:['触发'],enabled:true,constant:false,position:1},
        ]};
        expect(parseLinkWorldbookJson(standard,'酒馆').recognized).toBe(false);
    });
    it('does not create an invalid title-only empty entry, and reports its omission',()=>{
        const result=parseLinkWorldbookJson({scope:'local',title:'合集',
            entries:[{title:'空白条目',content:'',keys:[],activation:'constant'},
                {title:'正文章节',content:'真实正文',activation:'constant'}]},'合集');
        expect(result.books.map(x=>x.title)).toEqual(['正文章节']);
        expect(result.warnings.join(' ')).toContain('空白条目');
    });
    it('rejects duplicate source identifiers, avoiding overwrite of distinct lore',()=>{
        const raw={worldBooks:[{title:'S',id:'same',scope:'local',entries:[
            {id:'dup',title:'第一条',content:'a',activation:'constant'},
            {id:'dup',title:'第二条',content:'b',activation:'constant'},
        ]}]};
        expect(()=>parseLinkWorldbookJson(raw,'test')).toThrow('重复条目 ID');
    });

    it('rejects invalid activation or oversized payload rather than partially applying an import',()=>{
        expect(()=>parseLinkWorldbookJson({entries:[{title:'坏模式',content:'正文',activation:'javascript'}]},'测试'))
            .toThrow('激活模式');
        expect(()=>parseLinkWorldbookJson({entries:[{title:'过大',content:'x'.repeat(200001),activation:'constant'}]},'测试'))
            .toThrow('正文过长');
    });
});