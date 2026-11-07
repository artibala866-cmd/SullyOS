import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { docxXmlToText, readLinkPersonaDocument, readLinkWorldbookJsonText } from './linkImportDocuments';
import { readCharacterCardFile } from './sillyTavernCard';

describe('Link APK TXT/DOC/DOCX character import compatibility',()=>{
    it('accepts UTF-8, UTF-16 and common Chinese GBK TXT without garbling characters',async()=>{
        const utf8=new File(['人物背景\n第二段'],'江湖角色.txt',{type:'text/plain'});
        expect(await readLinkPersonaDocument(utf8)).toBe('人物背景\n第二段');
        const utf16=new File([new Uint8Array([0xff,0xfe,0x60,0x4f,0x7d,0x59])],'中文.txt');
        expect(await readLinkPersonaDocument(utf16)).toBe('你好');
        const gbk=new File([new Uint8Array([0xc4,0xe3,0xba,0xc3])],'中文GBK.txt');
        expect(await readLinkPersonaDocument(gbk)).toBe('你好');
    });
    it('extracts DOCX body, tabs and linebreaks without HTML tags',async()=>{
        const xml='<w:document><w:body><w:p><w:r><w:t>第一段</w:t></w:r><w:r><w:tab/><w:t>设定</w:t></w:r></w:p>'+
            '<w:p><w:r><w:t>第二段</w:t><w:br/><w:t>第三行</w:t></w:r></w:p></w:body></w:document>';
        expect(docxXmlToText(xml)).toBe('第一段\t设定\n第二段\n第三行');
        const zip=new JSZip();zip.file('word/document.xml',xml);
        const content=await zip.generateAsync({type:'uint8array'});
        const file=new File([Uint8Array.from(content).buffer],'洛川.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
        const card=await readCharacterCardFile(file);
        expect(card.source).toBe('document');
        if(card.source==='babylink')throw Error('Document must not parse as Link PNG');
        expect(card.character.name).toBe('洛川');
        expect(card.character.systemPrompt).toContain('第一段\t设定\n第二段\n第三行');
        expect(card.worldbooks).toEqual([]);
        expect(card.character.tavernGreetings).toBeUndefined();
    });
    it('imports text as a complete persona rather than mis-splitting opening or worldbook text',async()=>{
        const text='【角色设定】\n{{user}}初次来到这里。\n<!-- title:剧情标题，仅为原文 -->\n<scene>完整保留</scene>';
        const card=await readCharacterCardFile(new File([text],'何谈爱.txt'));
        expect(card.source).toBe('document');
        if(card.source==='babylink')throw Error('Wrong format');
        expect(card.character.systemPrompt).toContain(text);
        expect(card.character.tavernGreetings).toBeUndefined();
        expect(card.worldbooks).toEqual([]);
    });
    it('still imports legacy 2MB+ worldbook JSON without persona truncation or encoding loss',async()=>{
        const contents='世界观说明'.repeat(420000);
        const json=JSON.stringify({entries:[{comment:'完整设定',content:contents,key:['触发']}]});
        const file=new File([json],'大型世界书.json',{type:'application/json'});
        expect(json.length).toBeGreaterThan(2_000_000);
        expect(await readLinkWorldbookJsonText(file)).toBe(json);
        const gbk=new File([new Uint8Array([0x7b,0x22,0xc4,0xe3,0xba,0xc3,0x22,0x3a,0x31,0x7d]).buffer],
            '中文.json',{type:'application/json'});
        expect(await readLinkWorldbookJsonText(gbk)).toBe('{"你好":1}');
    });
    it('does not corrupt legacy binary DOC or arbitrary ZIP lacking Word XML',async()=>{
        const binary=new File([new Uint8Array([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1,0,1,2]).buffer],'old.doc');
        await expect(readLinkPersonaDocument(binary)).rejects.toThrow('二进制 DOC');
        const zip=new JSZip();zip.file('not-word.txt','hello');
        await expect(readLinkPersonaDocument(new File([Uint8Array.from(await zip.generateAsync({type:'uint8array'})).buffer],'wrong.docx')))
            .rejects.toThrow('没有 Word 正文');
    });
    it('rejects blank, too large and invalid name documents without changing database',async()=>{
        await expect(readCharacterCardFile(new File(['   '],'empty.txt'))).rejects.toThrow('没有可读取');
        await expect(readCharacterCardFile(new File(['Hi'],'.txt'))).rejects.toThrow('文件名无法作为角色姓名');
        await expect(readLinkPersonaDocument(new File([new Uint8Array(26*1024*1024)],'huge.txt')))
            .rejects.toThrow('25 MB');
    });
});