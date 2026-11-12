import React from 'react';
import { CharacterProfile, CharacterGroup } from '../../types';

/**
 * 角色分组的公共工具 + 选角入口的分组筛选胶囊条。
 *
 * 背景：角色一多，「神经链接 / 打电话 / 见面 / 查手机 / 转发」这些选角列表就会太长。
 * 各入口的列表 UI 千差万别（竖列 / grid / 横滑分页），所以这里不做统一的"角色选择器"，
 * 而是提供最小公共件：一条按分组筛选的胶囊条 + 纯函数筛选逻辑，各入口把筛选结果
 * 喂给自己原有的列表/分页渲染即可。没建过分组的用户，胶囊条整体不渲染，各入口零变化。
 */

/** 「全部」虚拟分组 id */
export const GROUP_FILTER_ALL = 'all';
/** 「未分组」虚拟分组 id（groupId 为空、或指向已删分组的角色都算） */
export const GROUP_FILTER_UNGROUPED = '__ungrouped__';

/** 分组显示顺序：order 优先，缺省按创建时间先后 */
export const sortCharacterGroups = (groups: CharacterGroup[]): CharacterGroup[] =>
    [...groups].sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0));

/** 按分组筛选角色。groupId 传 GROUP_FILTER_ALL / GROUP_FILTER_UNGROUPED / 具体分组 id */
export const filterCharactersByGroup = (
    characters: CharacterProfile[],
    groups: CharacterGroup[],
    groupId: string,
): CharacterProfile[] => {
    if (groupId === GROUP_FILTER_ALL) return characters;
    if (groupId === GROUP_FILTER_UNGROUPED) {
        const known = new Set(groups.map(g => g.id));
        return characters.filter(c => !c.groupId || !known.has(c.groupId));
    }
    return characters.filter(c => c.groupId === groupId);
};

interface FilterBarProps {
    /** 该入口的完整候选列表（未筛选），用于计算各组数量与是否显示「未分组」 */
    characters: CharacterProfile[];
    groups: CharacterGroup[];
    value: string;
    onChange: (groupId: string) => void;
    /** 深色底的 App（打电话 / 见面 / 查手机）传 true，胶囊换白字配色 */
    dark?: boolean;
    /** 浅灰玻璃背景专用样式，其他入口保持原来的配色 */
    appearance?: 'default' | 'mist';
    className?: string;
}

/**
 * 分组筛选胶囊条：全部 / 各分组 / 未分组，横向可滚动。
 * groups 为空时返回 null——没用分组的用户看不到任何变化。
 */
export const CharacterGroupFilterBar: React.FC<FilterBarProps> = ({ characters, groups, value, onChange, dark, appearance = 'default', className }) => {
    if (groups.length === 0) return null;

    const known = new Set(groups.map(g => g.id));
    const ungroupedCount = characters.filter(c => !c.groupId || !known.has(c.groupId)).length;
    const chips: { id: string; label: string; count: number }[] = [
        { id: GROUP_FILTER_ALL, label: '全部', count: characters.length },
        ...sortCharacterGroups(groups).map(g => ({
            id: g.id,
            label: g.name,
            count: characters.filter(c => c.groupId === g.id).length,
        })),
    ];
    if (ungroupedCount > 0) chips.push({ id: GROUP_FILTER_UNGROUPED, label: '未分组', count: ungroupedCount });

    const mist = appearance === 'mist';
    const base = mist
        ? 'shrink-0 h-9 max-w-[11rem] px-3.5 rounded-full text-xs font-semibold border transition-all duration-200 active:scale-95 flex items-center gap-1.5 snap-start'
        : 'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all active:scale-95 flex items-center gap-1';
    const idle = mist
        ? 'bg-white/40 text-neutral-600 border-white/60 hover:bg-white/70'
        : dark
            ? 'bg-white/[0.06] text-white/60 border-white/15'
            : 'bg-white/70 text-slate-500 border-slate-200';
    const active = mist
        ? 'bg-white/95 text-neutral-800 border-white shadow-[0_2px_10px_rgba(100,100,100,0.13)]'
        : dark
            ? 'bg-white/90 text-slate-900 border-white'
            : 'bg-slate-700 text-white border-slate-700';

    return (
        <div className={`flex gap-1.5 overflow-x-auto no-scrollbar ${mist ? 'snap-x snap-proximity py-0.5' : ''} ${className || ''}`}>
            {chips.map(chip => (
                <button
                    key={chip.id}
                    onClick={() => onChange(chip.id)}
                    aria-pressed={value === chip.id}
                    title={chip.label}
                    className={`${base} ${value === chip.id ? active : idle}`}
                >
                    <span className={mist ? 'truncate' : undefined}>{chip.label}</span>
                    <span className={`${mist ? 'shrink-0 text-[10px]' : ''} ${value === chip.id ? 'opacity-75' : mist ? 'opacity-70' : 'opacity-50'}`}>{chip.count}</span>
                </button>
            ))}
        </div>
    );
};
