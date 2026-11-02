import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const text=(name:string)=>readFileSync(new URL(name,import.meta.url),'utf8');

describe('all-off deliver/remote repair wiring',()=>{
  it('has no 1.0 sender and keeps one-way cleanup on startup/resume', () => {
    const os=text('../context/OSContext.tsx');
    expect(os).not.toContain('getDueScheduledMessages');
    expect(os).not.toContain('proactive-message-sent');
    expect(os).not.toContain('sully-legacy-scheduled-delivery');
    expect(os).toContain('await retireLegacyAiMessages()');
    expect(os).toContain("document.addEventListener('visibilitychange', onVisible)");
  });
  it('cloud scheduled messages are rejected before post-processing, side effects, chat persistence and notifications',()=>{
    const runtime=text('./activeMsgRuntime.ts');
    const gate=runtime.indexOf('if (!allowCloudAmsgDelivery(message, recipient?.activeMsg2Config?.enabled === true))');
    const effects=runtime.indexOf('await replyStep(async () => adoptSelfScheduledTasks(message))');
    const persist=runtime.indexOf('await replyStep(async () => processInboxMessageWithPostProcessing(');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(effects);
    expect(gate).toBeLessThan(persist);
  });
  it('OS-global runner audits disabled roles and the OFF switch explicitly forces the audit',()=>{
    const os=text('../context/OSContext.tsx');
    const ui=text('../components/chat/ActiveMsg2SettingsModal.tsx');
    expect(os).toContain('await reconcileDisabledAmsgTasks(scope, id)');
    expect(os).toContain("[isDataLoaded, amsgMasterStates]");
    expect(ui).toContain('requestImmediateDisabledAmsgRepair(char.id)');
    expect(ui).toContain("window.dispatchEvent(new Event('sully:amsg-autonomy-refresh'))");
  });
});
