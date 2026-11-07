import { describe, expect, it } from 'vitest';
import type { CardImportOrigin, CharacterProfile } from '../types';
import { DB } from './db';
import { normalizeCharacterCard } from './sillyTavernCard';
import { normalizeBabyLinkShare } from './babyLinkCard';
import { mergeCardImports, type CardImportItem } from './cardImportMerge';
import { selectCardImportSections } from './cardImportSections';
import { characterRemark, chatCharacterDisplayName } from './characterRemark';
import { importedCardRemarkCorrection } from './cardImportRemark';

const role=(id:string,source:CardImportOrigin['source'],description:string,systemPrompt:string,other:Partial<CharacterProfile>={}):CharacterProfile=>({
    id,name:'季淮北',avatar:'',description,systemPrompt,memories:[],mountedWorldbooks:[],
    cardImportOrigin:{source,originalName:'季淮北'},...other,
});
const tavern=(version:'v1'|'v2'|'v3'='v3')=>{
    const data={name:'季淮北',description:'人物介绍第一段\n\n人物经历第二段\n隐秘历史不应写入备注',
        personality:'冷静坚韧',scenario:'雨夜故事',nickname:'小北',
        first_mes:'走进屋内',character_book:{entries:[]}};
    if(version==='v1')return normalizeCharacterCard(data);
    return normalizeCharacterCard({spec:version==='v2'?'chara_card_v2':'chara_card_v3',
        spec_version:version==='v2'?'2.0':'3.0',data});
};
const link=(nickname:string,description='原版完整人设，绝对不能进入备注')=>normalizeBabyLinkShare({
    magic:'LINK_CHARACTER_SHARE_PNG_V1',version:1,
    characters:[{id:'link-source-22',name:'季淮北',nickname,description,
        signature:'签名应单独放 AI 上下文',avatar:'',
        localWorldBookIds:[],openings:[{title:'第一幕',opening:'雪夜开始'}]}],
    worldBooks:[],
}).cards[0];
const item=(prepared:ReturnType<typeof tavern>|ReturnType<typeof link>,origin:CardImportOrigin,
    expectedTargetId:string|null,sections={persona:true,worldbooks:false,greetings:true}):CardImportItem=>{
    const selected=selectCardImportSections(prepared,sections);
    return {origin,expectedTargetId,fields:selected.fields,worldbooks:selected.worldbooks,
        character:{
            ...selected.fields,id:expectedTargetId||'new-role',name:prepared.character.name,
            avatar:'',description:prepared.character.description||'',
            systemPrompt:prepared.character.systemPrompt||'',memories:[],mountedWorldbooks:[],
        } as CharacterProfile};
};
describe('Tavern & Link import keeps Neural Link remarks independent',()=>{
    for(const version of ['v1','v2','v3'] as const){
        it('Tavern '+version+' imports all persona text into AI prompt but zero text into remark',()=>{
            const parsed=tavern(version);
            expect(parsed.character.description).toBe('');
            expect(parsed.character.systemPrompt).toContain('人物介绍第一段\n\n人物经历第二段');
            expect(parsed.character.systemPrompt).toContain('冷静坚韧');
            expect(parsed.character.systemPrompt).toContain('【角色昵称】小北');
            expect(parsed.character.worldview).toBe('雨夜故事');
            expect(parsed.character.tavernGreetings).toHaveLength(1);
            const first=mergeCardImports([],[],[item(parsed,{source:'tavern',originalName:'季淮北'},null)]);
            expect(first.characters[0].description).toBe('');
            expect(first.characters[0].systemPrompt).toBe(parsed.character.systemPrompt);
            expect(characterRemark(first.characters[0].description)).toBe('');
            expect(chatCharacterDisplayName({...first.characters[0],chatShowRemark:true})).toBe('季淮北');
        });
    }
    it('Link nickname only; neither signature, intro nor opening leaks into remark',()=>{
        const prepared=link('阿北','一万字人设'.repeat(300));
        expect(prepared.character.description).toBe('阿北');
        expect(prepared.character.systemPrompt).toContain('一万字人设');
        expect(prepared.character.systemPrompt).toContain('角色签名');
        const saved=mergeCardImports([],[],[item(prepared,{source:'babylink',originalName:'季淮北',externalId:'link-source-22'},null)]);
        expect(saved.characters[0].description).toBe('阿北');
        expect(saved.characters[0].linkGreetings).toHaveLength(1);
        expect(saved.characters[0].systemPrompt).toContain('一万字人设');
    });
    it('Link initial nickname equal to character name can safely update with source changes',()=>{
        const prepared=link('季淮北');
        const origin:CardImportOrigin={source:'babylink',originalName:'季淮北',externalId:'link-source-22'};
        const first=mergeCardImports([],[],[item(prepared,origin,null)]);
        const original=first.characters[0];
        expect(original.description).toBe('季淮北');
        expect(original.cardImportOrigin?.importedRemark).toBe('季淮北');
        const updated=mergeCardImports([original],[],[item(link('阿北'),origin,original.id)]);
        expect(updated.characters[0].description).toBe('阿北');
        expect(updated.characters[0].cardImportOrigin?.importedRemark).toBe('阿北');
        const customized={...original,description:'我手写的长期备注'};
        const protectedPlan=mergeCardImports([customized],[],[item(link('新昵称'),origin,customized.id)]);
        expect(protectedPlan.characters[0].description).toBe('我手写的长期备注');
        expect(protectedPlan.characters[0].cardImportOrigin?.importedRemark).toBe('季淮北');
    });
    it('Link empty nickname leaves empty remark, never substitute signature or prose',()=>{
        expect(link('').character.description).toBe('');
        expect(link('季淮北').character.description).toBe('季淮北');
    });
    it('old Tavern remark exactly matching generated persona is cleaned, but manual remarks are protected',()=>{
        const parsed=tavern();
        const oldRemark='人物介绍第一段\n\n人物经历第二段\n隐秘历史不应写入备注\n【角色昵称】小北';
        const old=role('tavern-old','tavern',oldRemark,parsed.character.systemPrompt,{
            memories:[{id:'memory-id',content:'已有聊天记忆'}] as unknown as CharacterProfile['memories'],
            tavernGreetings:[{id:'tavern-first',title:'旧开场',content:'走进屋内'}],
        });
        expect(importedCardRemarkCorrection(old)).toBe('');
        const changed=mergeCardImports([old],[],[item(parsed,old.cardImportOrigin!,old.id)]);
        expect(changed.characters[0].description).toBe('');
        expect(changed.characters[0].memories).toEqual(old.memories);
        expect(changed.characters[0].tavernGreetings?.[0].id).toBe('tavern-first');
        expect(changed.characters[0].systemPrompt).toBe(parsed.character.systemPrompt);
        expect(importedCardRemarkCorrection({...old,description:'我手写的备注'})).toBeNull();
        const custom=mergeCardImports([{...old,description:'我手写的备注'}],[],[
            item(parsed,old.cardImportOrigin!,old.id)]);
        expect(custom.characters[0].description).toBe('我手写的备注');
    });
    it('legacy Link generated summary shortens to nickname on reimport; handwritten note remains untouched',()=>{
        const prepared=link('阿北','人物经历第一行\n多行设定');
        const oldSummary='昵称：阿北 · 签名：签名应单独放 AI 上下文 · 人物经历第一行';
        const old=role('link-old','babylink',oldSummary,prepared.character.systemPrompt);
        expect(importedCardRemarkCorrection(old)).toBe('阿北');
        const changed=mergeCardImports([old],[],[
            item(prepared,{source:'babylink',originalName:old.name,externalId:'link-source-22'},old.id)]);
        expect(changed.characters[0].description).toBe('阿北');
        expect(changed.characters[0].systemPrompt).toContain('人物经历第一行');
        const custom=mergeCardImports([{...old,description:'私人备注：这个角色叫哥哥'}],[],[
            item(prepared,{source:'babylink',originalName:old.name,externalId:'link-source-22'},old.id)]);
        expect(custom.characters[0].description).toBe('私人备注：这个角色叫哥哥');
    });
    it('repairs only the exact legacy TXT/DOCX persona-prefix remark, never manual or native remarks',()=>{
        const persona='第一个角色段落。'.repeat(85);
        const prompt='【导入人物原始文档】\n'+persona;
        const old=role('doc','document',persona.slice(0,260),prompt);
        expect(importedCardRemarkCorrection(old)).toBe('');
        const manual={...old,description:'自己手写的重要备注'};
        expect(importedCardRemarkCorrection(manual)).toBeNull();
        const native=role('sully-native','sully',persona.slice(0,260),prompt);
        expect(importedCardRemarkCorrection(native)).toBeNull();
        const normalized=mergeCardImports([old],[],[{
            character:old, expectedTargetId:old.id,
            fields:{name:old.name,description:'',systemPrompt:prompt},
            worldbooks:[],origin:old.cardImportOrigin!,
        }]);
        expect(normalized.characters[0].description).toBe('');
        expect(normalized.characters[0].systemPrompt).toBe(prompt);
    });

    it('Link nickname changes on update but does not overwrite a user-edited remark',()=>{
        const old=role('link-name','babylink','阿北',link('阿北').character.systemPrompt!);
        const next=link('小北');
        const updated=mergeCardImports([old],[],[
            item(next,{source:'babylink',originalName:old.name},old.id)]);
        expect(updated.characters[0].description).toBe('小北');
        const manual=mergeCardImports([{...old,description:'自己写的备注'}],[],[
            item(next,{source:'babylink',originalName:old.name},old.id)]);
        expect(manual.characters[0].description).toBe('自己写的备注');
    });
    it('importing only greetings or worldbooks leaves legacy and handwritten remarks unchanged',()=>{
        const parsed=tavern();
        const existing=role('existing','tavern','我写的备注',parsed.character.systemPrompt!);
        const onlyGreetings=item(parsed,existing.cardImportOrigin!,existing.id,
            {persona:false,worldbooks:false,greetings:true});
        expect(mergeCardImports([existing],[],[onlyGreetings]).characters[0].description).toBe('我写的备注');
        const onlyWorldbook=item(parsed,existing.cardImportOrigin!,existing.id,
            {persona:false,worldbooks:true,greetings:false});
        const loreResult=mergeCardImports([existing],[],[onlyWorldbook]);
        expect((loreResult.characters[0]||existing).description).toBe('我写的备注');
        expect(loreResult.result.unchangedIds).toEqual([existing.id]);
    });
});
describe('persisted old imported-card remark migration',()=>{
    it('repairs old Tavern and Link after save/reopen without deleting other character data',async()=>{
        const suffix=Date.now()+'-'+Math.random().toString(36).slice(2);
        const tav=tavern();
        const t=role('remark-old-tavern-'+suffix,'tavern',
            '人物介绍第一段\n\n人物经历第二段\n隐秘历史不应写入备注\n【角色昵称】小北',
            tav.character.systemPrompt!,{memories:[{id:'mem-t',content:'保存的记忆'}] as unknown as CharacterProfile['memories'],
            tavernGreetings:[{id:'keep-opening',title:'开场',content:'不要删'}]});
        const lPrepared=link('阿北','人物经历第一行\n后续剧情');
        const l=role('remark-old-link-'+suffix,'babylink',
            '昵称：阿北 · 签名：签名应单独放 AI 上下文 · 人物经历第一行',
            lPrepared.character.systemPrompt!);
        const untouched=role('remark-my-note-'+suffix,'tavern','我自己写的备注',t.systemPrompt);
        await DB.saveCharacter(t);await DB.saveCharacter(l);await DB.saveCharacter(untouched);
        const count=await DB.repairImportedCardRemarks();
        expect(count).toBeGreaterThanOrEqual(2);
        expect((await DB.getCharacter(t.id))?.description).toBe('');
        expect((await DB.getCharacter(l.id))?.description).toBe('阿北');
        expect((await DB.getCharacter(untouched.id))?.description).toBe('我自己写的备注');
        expect((await DB.getCharacter(t.id))?.memories).toEqual(t.memories);
        expect((await DB.getCharacter(t.id))?.tavernGreetings).toEqual(t.tavernGreetings);
        const second=await DB.repairImportedCardRemarks();
        expect(second).toBe(0);
    });
});
