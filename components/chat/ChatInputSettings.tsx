import React, { useState } from 'react';
import { Question } from '@phosphor-icons/react';
import type { ChatInputPreferences } from '../../utils/chatInputPreferences';

interface ChatInputSettingsProps {
    value: ChatInputPreferences;
    onChange: (value: ChatInputPreferences) => void;
    scope?: 'private' | 'group';
}

const ChatInputSettings: React.FC<ChatInputSettingsProps> = ({ value, onChange, scope = 'private' }) => {
    const [openHelp, setOpenHelp] = useState<keyof ChatInputPreferences | null>(null);
    return (
        <div className="space-y-1">
            <p className="mb-2 text-[10px] text-slate-400">以下输入习惯对当前设备的私聊和群聊生效</p>
            {([
                {
                    key: 'sendButtonGenerates',
                    label: '发送按钮代替生成按钮',
                    help: '开启后，不用够右上角的闪电了。输入框里有光标时，右下角发文字；点一下聊天空白处，右下角就变成闪电，让对方回复已发送的消息。只收起键盘可能还留着光标，点一下空白处就好。没发出的草稿会保留。',
                },
                {
                    key: 'enterToSend',
                    label: '回车发送文字',
                    help: '勾选时，按回车发送文字，Shift + 回车换行；不勾选时，回车只换行，点发送按钮发出文字。输入法选字时按回车不会误发。',
                },
                {
                    key: 'autoReply',
                    label: '发完后自动生成回复',
                    help: scope === 'group'
                        ? '发送成功后按群聊现有规则等待回复；正在编辑、有草稿或打开面板时暂停。退出群聊取消等待。'
                        : '决定发送后是否自动接话。关闭后“真人感”不会单独触发私聊回复，手动闪电仍可用。开启后成功发送、结束输入且没有草稿时自然等待；真人感仅调整忙闲与睡眠节奏。不显示倒计时，继续输入会取消旧候选。',
                },
                {
                    key: 'emojiSuggestions',
                    label: '表情包智能匹配',
                    help: '输入“抱”就会联想名称里有“抱”的表情包，点击候选即可发送。私聊匹配当前角色可见的所有分类，群聊匹配群聊表情库的所有分类，文字草稿会保留。两者共用开关，默认关闭。',
                },
                {
                    key: 'linkCards', label: '分享链接自动转卡片（私聊）',
                    help: '自动解析抖音、网易云等网页分享链接。关闭后原文和链接直接发给角色，可交给你配置的 MCP 处理；小红书由下面的独立开关控制。卡片也会保留原链接和附带文字。',
                },
                {
                    key: 'xhsCards', label: '小红书链接自动转卡片（私聊）',
                    help: '独立识别小红书官网和 xhslink.com / xhslink.cn 分享链接。关闭后直接发送原文；不影响角色主动浏览小红书的配置。',
                },
            ] as const).filter(item => scope === 'private' || !['linkCards', 'xhsCards'].includes(item.key)).map(({ key, label, help }) => (
                <div key={key}>
                    <div className="flex items-center gap-1">
                        <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 text-xs font-bold text-slate-600">
                            <span>{label}</span>
                            <input
                                type="checkbox"
                                checked={key === 'linkCards' || key === 'xhsCards' ? value[key] !== false : value[key] === true}
                                onChange={event => onChange({ ...value, [key]: event.target.checked })}
                                className="h-5 w-5 shrink-0 cursor-pointer accent-primary"
                            />
                        </label>
                        <button
                            type="button"
                            aria-label={`${label}说明`}
                            aria-expanded={openHelp === key}
                            aria-controls={`chat-input-help-${key}`}
                            onClick={() => setOpenHelp(openHelp === key ? null : key)}
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-slate-100 ${openHelp === key ? 'text-primary' : 'text-slate-400'}`}
                        >
                            <Question size={18} weight="bold" />
                        </button>
                    </div>
                    <p id={`chat-input-help-${key}`} hidden={openHelp !== key} className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">{help}</p>
                </div>
            ))}
        </div>
    );
};

export default ChatInputSettings;
