import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildWorkspacePrivateChatBlock, loadWorkspacePrivateChatBlock,
} from './workspacePrivateChat';
import {
  emptyWorkspace, normalizeWorkspace, permissionForChar,
} from './sullyWorkspace';

let stored: unknown = null;
vi.mock('./db', () => ({
  DB: { getAssetRaw: vi.fn(async () => stored), saveAssetRaw: vi.fn(async () => {}) },
}));
const base = () => {
  const data = emptyWorkspace();
  data.classes = [{id:'lesson',name:'数字速写',weekday:4,start:'10:00',end:'12:00',until:'',
    teacher:'TEACHER_PRIVATE',location:'LOCATION_PRIVATE',note:'CLASS_NOTE_PRIVATE'}];
  data.homework = [{id:'h1',classId:'lesson',title:'透视练习',dueAt:'2026-11-21T16:00',
    done:false,note:'HOMEWORK_NOTE_PRIVATE',minutes:50}];
  data.commissions = [{
    id:'c1',title:'立绘',client:'CLIENT_PRIVATE',price:'PRICE_PRIVATE',
    brief:'BRIEF_PRIVATE',note:'COMMISSION_NOTE_PRIVATE',paid:false,
    type:'TYPE_PRIVATE',acceptedAt:'',dueDate:'2026-11-23',stage:'线稿',
    priority:1,status:'active',remainingMinutes:80,bufferMinutes:40,
    plannedDate:'2026-11-20',order:1,
  }];
  data.notes = [{id:'n1',classId:'lesson',body:'NOTE_CONTENT_PRIVATE',createdAt:1}];
  return data;
};

describe('学习室普通私聊授权，按 Char 和分类分隔', () => {
  beforeEach(() => { stored = null; });
  it('旧数据、缺字段、null 和无效开关默认全部拒绝', () => {
    const legacy = normalizeWorkspace({classes:base().classes,commissions:base().commissions});
    expect(legacy.privateChatPermissions).toEqual({});
    expect(permissionForChar(legacy,'charA')).toEqual({study:false,commissions:false});
    expect(buildWorkspacePrivateChatBlock(legacy,'charA')).toBe('');
    expect(normalizeWorkspace({privateChatPermissions:{charA:{study:'true',commissions:1}}})
      .privateChatPermissions.charA).toEqual({study:false,commissions:false});
  });
  it('只授权学习，不泄漏委托或任何笔记、老师、地点', () => {
    const data = base(); data.privateChatPermissions = {charA:{study:true,commissions:false}};
    const block = buildWorkspacePrivateChatBlock(data,'charA');
    expect(block).toContain('数字速写');
    expect(block).toContain('透视练习');
    expect(block).not.toContain('立绘');
    expect(block).not.toContain('CLASS_NOTE_PRIVATE');
    expect(block).not.toContain('HOMEWORK_NOTE_PRIVATE');
    expect(block).not.toContain('NOTE_CONTENT_PRIVATE');
    expect(block).not.toContain('TEACHER_PRIVATE');
    expect(block).not.toContain('LOCATION_PRIVATE');
    expect(buildWorkspacePrivateChatBlock(data,'charB')).toBe('');
  });
  it('只授权排单，不传客户/价格/需求/便签或课程', () => {
    const data = base(); data.privateChatPermissions = {charA:{study:false,commissions:true}};
    const block = buildWorkspacePrivateChatBlock(data,'charA');
    expect(block).toContain('线稿');
    expect(block).not.toContain('立绘');
    expect(block).not.toContain('数字速写');
    // A title itself can contain client names / an invoice, so no title is shared.
    for (const secret of ['CLIENT_PRIVATE','PRICE_PRIVATE','BRIEF_PRIVATE',
      'COMMISSION_NOTE_PRIVATE','TYPE_PRIVATE','NOTE_CONTENT_PRIVATE']) {
      expect(block).not.toContain(secret);
    }
  });
  it('每轮从数据库读新授权，撤销后不带旧记录继续请求', async () => {
    const data = base();
    data.privateChatPermissions={charA:{study:true,commissions:false}};
    stored=data;
    expect(await loadWorkspacePrivateChatBlock('charA')).toContain('数字速写');
    data.privateChatPermissions.charA.study=false;
    expect(await loadWorkspacePrivateChatBlock('charA')).toBe('');
    expect(await loadWorkspacePrivateChatBlock('charB')).toBe('');
  });
});
