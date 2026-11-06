/** Chromium QA harness mounts the ACTUAL ChatModals, not a mock-up. */
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ChatModals from '../components/chat/ChatModals';

const observations: string[] = [];
window.addEventListener('error', e => observations.push(e.message));
window.addEventListener('unhandledrejection', e => observations.push(String(e.reason)));
function Fixture() {
    const [emojiImportText, setEmojiImportText] = useState('这是一行来自旧粘贴内容的无效格式');
    const [modalType, setModalType] = useState('emoji-import');
    return <ChatModals {...({
        modalType, setModalType,
        emojiImportText, setEmojiImportText,
        emojiImportBusy: false,
        onImportEmoji: () => observations.push('import-button-click'),
        transferAmt: '', transferNote: '',
        settingsContextLimit: 500,
        settingsContextRangeMode: 'manual',
        settingsHideSysLogs: false,
        settingsInputPreferences: {},
        contextSuiteAnyEnabled: false,
        contextSuiteAllEnabled: false,
        editContent: '', newCategoryName: '', newEmojiName: '',
        activeCharacter: null, messages: [], allHistoryMessages: [],
        allCharacters: [], apiPresets: [], selectedCategory: null,
        scheduleData: null,
        onTransfer: () => {}, onSaveSettings: () => {},
        onSetHistoryStart: () => {},
        setSettingsContextLimit: () => {},
        setSettingsContextRangeMode: () => {},
        setSettingsHideSysLogs: () => {},
        setSettingsInputPreferences: () => {},
        setTransferAmt: () => {}, setTransferNote: () => {},
        setEditContent: () => {},
        setNewCategoryName: () => {},
        setNewEmojiName: () => {},
    } as any)} />;
}
createRoot(document.querySelector('#root')!).render(<Fixture/>);
function bounds(el: Element | null) {
    if (!el) return null;
    const r=el.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};
}
async function exercise() {
    try {
        let input:HTMLInputElement|null=null;
        for(let attempt=0;attempt<100;attempt++){
            input=document.querySelector<HTMLInputElement>('input[aria-label="选择表情包文档"]');
            if(input)break;
            await new Promise(r=>setTimeout(r,60));
        }
        if(!input)throw new Error('The actual emoji file chooser did not render; errors=' + JSON.stringify(observations) + '; DOM=' + (document.body?.innerText || '').slice(0,1300));
        const file=new File([
            '来源说明：示例文档\n',
            '开心：https://example.com/a.gif\n',
            'https://files.catbox.moe/abc123.png\n',
            'https://example.com/b.gif 不理人\n'
        ],'emoji-qa.txt',{type:'text/plain'});
        const transfer=new DataTransfer(); transfer.items.add(file);
        input.files=transfer.files;
        input.dispatchEvent(new Event('change',{bubbles:true}));
        let status='';
        for(let attempt=0;attempt<120;attempt++){
            status=document.querySelector('[role="status"]')?.textContent || '';
            if(status.includes('已识别') || status.includes('未能'))break;
            await new Promise(r=>setTimeout(r,70));
        }
        const dialog=[...document.querySelectorAll('h3')].find(el=>el.textContent?.includes('表情注入'))?.closest('.relative') || null;
        const footer=[...document.querySelectorAll('button')].find(el=>el.textContent?.includes('添加至当前分类')) || null;
        const textarea=document.querySelector<HTMLTextAreaElement>('textarea');
        const cleanButton=[...document.querySelectorAll('button')].find(el=>el.textContent?.includes('只保留已识别内容')) as HTMLButtonElement | undefined;
        const report = {
            viewport:[innerWidth,innerHeight],status,
            recognizedText:textarea?.value || '',
            fileButtonVisible:!!input && !!document.querySelector('button')?.textContent,
            dialog:bounds(dialog),footer:bounds(footer),textarea:bounds(textarea),
            overflowX:document.documentElement.scrollWidth-innerWidth,
            footerVisible:!!footer && footer.getBoundingClientRect().bottom<=innerHeight+2,
            cleanButtonVisible:!!cleanButton,saveBlockedUntilClean:(footer as HTMLButtonElement)?.disabled,
            errors:observations,
        };
        const okay=report.recognizedText.includes('开心--https://example.com/a.gif') &&
            report.recognizedText.includes('abc123--https://files.catbox.moe/abc123.png') &&
            report.recognizedText.includes('不理人--https://example.com/b.gif') &&
            report.status.includes('3 条表情') &&
            report.cleanButtonVisible && report.saveBlockedUntilClean &&
            report.footerVisible && report.overflowX<=2 && report.errors.length===0;
        document.querySelector('#qa-report')!.textContent=JSON.stringify(report);
        document.body.dataset.emojiDocumentVisualReady=String(okay);
    } catch(e) {
        document.body.dataset.emojiDocumentVisualReady='false';
        document.querySelector('#qa-report')!.textContent=String(e instanceof Error ? e.stack : e);
    }
}
setTimeout(()=>{void exercise()},180);
