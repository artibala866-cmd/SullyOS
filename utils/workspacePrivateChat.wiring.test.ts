import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('学习室私聊授权数据流 wiring', () => {
  const chat = readFileSync(resolve(process.cwd(),'hooks/useChatAI.ts'),'utf8');
  const prompts = readFileSync(resolve(process.cwd(),'utils/chatPrompts.ts'),'utf8');
  const sync = readFileSync(resolve(process.cwd(),'utils/amsgStateSync.ts'),'utf8');

  it('只在 ChatApp 构建完整 payload 后、网络发送前重新读取授权', () => {
    const build = chat.indexOf('buildChatRequestPayload({');
    const load = chat.indexOf('loadWorkspacePrivateChatBlock(char.id)');
    const send = chat.indexOf('sendInstantChatTurn({');
    expect(build).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(build);
    expect(send).toBeGreaterThan(load);
    expect(chat).toContain('payload.fullMessages.splice(insertAt, 0');
    expect(chat).toContain("const workspaceChatBlock = payload.flags.promptBuildSkipped ? ''");
  });
  it('不会通过原有私聊提示词或 AMSG fire_pack 的持久上传读取工作空间', () => {
    expect(prompts).not.toContain('workspacePrivateChat');
    expect(sync).not.toContain('workspacePrivateChat');
  });
});
