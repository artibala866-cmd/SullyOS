import React, { useEffect, useState } from 'react';
import { FilmStrip, MagnifyingGlass, TextT } from '@phosphor-icons/react';
import {
    createMcpServer, loadMcpServers, saveMcpServers, resetMcpSession, testMcpConnection,
    type McpServerConfig,
} from '../../utils/mcpClient';

const PRESETS = [
    {
        id: 'realtime.orca',
        name: '电影与剧集 · Orca',
        url: 'https://orca-mcp.mmdju.workers.dev/mcp',
        source: 'https://github.com/mmdju/orca-mcp',
        hint: '公开影视资料服务；无需申请 Key。第三方端点可用性需实际测试。',
    },
    {
        id: 'realtime.bilibili.search',
        name: 'B站 · 视频搜索',
        url: '',
        source: 'https://github.com/masx200/bilibili-mcp-server',
        hint: '需要按源码部署 Streamable HTTP 服务；没有现成可领取的 Key。',
    },
    {
        id: 'realtime.bilibili.subtitles',
        name: 'B站 · 字幕与评论',
        url: '',
        source: 'https://github.com/masx200/bilibili-video-info-mcp',
        hint: '需要自行部署；部分字幕和评论请求可能需要 B站登录凭据。',
    },
] as const;

const RealtimeMcpPresets: React.FC<{ onConfigChanged: () => void }> = ({ onConfigChanged }) => {
    const [servers, setServers] = useState<McpServerConfig[]>(loadMcpServers);
    const [testing, setTesting] = useState<string | null>(null);
    const [statuses, setStatuses] = useState<Record<string, string>>({});
    // Migrate previously created cards to stable identities without changing credentials
    // or enabled state; future renames in generic MCP management won't break lookup.
    useEffect(() => {
        const current = loadMcpServers();
        let changed = false;
        const next = current.map(server => {
            if (server.presetId) return server;
            const preset = PRESETS.find(p => server.name === p.name || (!!p.url && server.url === p.url));
            if (!preset) return server;
            changed = true;
            return { ...server, presetId: preset.id };
        });
        if (changed) {
            saveMcpServers(next);
            setServers(next);
            onConfigChanged();
        }
    }, []);

    type Preset = typeof PRESETS[number];
    const match = (server: McpServerConfig, preset: Preset) =>
        server.presetId === preset.id ||
        (!server.presetId && (server.name === preset.name || (!!preset.url && server.url === preset.url)));

    // Always read the latest persisted configuration; async discovery must not overwrite edits
    // made while a request was in flight.
    const persist = (next: McpServerConfig[]) => {
        saveMcpServers(next);
        setServers(next);
        onConfigChanged();
    };
    const add = (preset: Preset) => {
        const current = loadMcpServers();
        const found = current.find(server => match(server, preset));
        if (found) {
            setServers(current);
            setStatuses(old => ({ ...old, [preset.name]: '已有配置，无需重复添加。' }));
            return;
        }
        const next = createMcpServer(preset.name, preset.url);
        next.presetId = preset.id;
        persist([...current, next]);
    };
    const update = (server: McpServerConfig, patch: Partial<McpServerConfig>, retest = false) => {
        if (retest) resetMcpSession(server.id);
        const next = loadMcpServers().map(item => item.id === server.id
            ? {
                ...item, ...patch,
                ...(retest ? { enabled: false, tools: undefined, lastConnection: undefined } : {}),
                updatedAt: Date.now(),
            }
            : item);
        persist(next);
    };
    const test = async (server: McpServerConfig) => {
        const snapshot = JSON.stringify([server.url, server.token, server.customHeaders, server.proxyUrl, server.proxyKey]);
        setTesting(server.id);
        setStatuses(old => ({ ...old, [server.name]: '正在测试连接并读取工具…' }));
        try {
            const result = await testMcpConnection(server);
            const current = loadMcpServers().find(item => item.id === server.id);
            const currentSnapshot = current && JSON.stringify([current.url, current.token, current.customHeaders, current.proxyUrl, current.proxyKey]);
            if (!current || snapshot !== currentSnapshot) {
                setStatuses(old => ({ ...old, [server.name]: '配置已变化，本次测试结果已丢弃，请重新测试。' }));
                return;
            }
            if (result.ok && result.tools && result.connection) {
                update(current, { tools: result.tools, lastConnection: result.connection });
                setStatuses(old => ({ ...old, [server.name]: result.message }));
            } else {
                setStatuses(old => ({ ...old, [server.name]: result.message || '连接失败' }));
            }
        } catch (error) {
            setStatuses(old => ({ ...old, [server.name]: error instanceof Error ? error.message : '连接失败' }));
        } finally {
            setTesting(null);
        }
    };
    const icons = [FilmStrip, MagnifyingGlass, TextT];
    return (
        <div className="space-y-4">
            {PRESETS.map((preset, index) => {
                const server = servers.find(s => match(s, preset));
                const ready = !!server?.tools?.length;
                const Icon = icons[index];
                return (
                    <div key={preset.name} className="bg-slate-100/60 p-4 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                                <Icon size={20} weight="fill" className="shrink-0 text-slate-800" />
                                <span className="text-sm font-bold text-slate-800">{preset.name}</span>
                                <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[9px] text-slate-600">
                                    {ready ? '已连接' : 'MCP'}
                                </span>
                            </div>
                            <label className="relative inline-flex shrink-0 items-center cursor-pointer">
                                <span className="sr-only">启用 {preset.name}</span>
                                <input type="checkbox" checked={!!server?.enabled}
                                    onChange={event => {
                                        if (!server) {
                                            add(preset);
                                            setStatuses(old => ({ ...old, [preset.name]: '已创建配置，请先展开配置、测试连接后再启用。' }));
                                        } else if (!ready && event.target.checked) {
                                            setStatuses(old => ({ ...old, [preset.name]: '请先填写服务地址并测试连接，再启用。' }));
                                        } else {
                                            update(server, { enabled: event.target.checked });
                                        }
                                    }}
                                    className="sr-only peer" />
                                <div className="w-11 h-6 bg-slate-300 rounded-full transition-colors peer-checked:bg-slate-800
                                    after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5
                                    after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-full" />
                            </label>
                        </div>
                        <p className="text-[10px] text-slate-500 leading-relaxed">{preset.hint}</p>
                        <details className="group">
                            <summary className="cursor-pointer text-[10px] font-semibold text-slate-700">配置与来源</summary>
                            <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                                <a href={preset.source} target="_blank" rel="noopener noreferrer"
                                    className="inline-block text-[10px] text-slate-700 underline underline-offset-2">
                                    查看原项目与部署说明 ↗
                                </a>
                                {!server ? (
                                    <button type="button" onClick={() => add(preset)}
                                        className="block rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">
                                        添加服务配置
                                    </button>
                                ) : (
                                    <>
                                        <input aria-label={`${preset.name} MCP 地址`} value={server.url}
                                            onChange={event => update(server, { url: event.target.value.trim() }, true)}
                                            placeholder="填写部署后的 https://…/mcp"
                                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700" />
                                        <input aria-label={`${preset.name} Bearer Token`} type="password"
                                            value={server.token || ''}
                                            onChange={event => update(server, { token: event.target.value.trim() }, true)}
                                            placeholder="Bearer Token（可选）"
                                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700" />
                                        {(server.customHeaders || []).map((header, headerIndex) => (
                                            <div key={headerIndex} className="flex gap-2">
                                                <input aria-label="请求头名称" value={header.name}
                                                    onChange={event => update(server, { customHeaders: (server.customHeaders || []).map((h, i) => i === headerIndex ? { ...h, name: event.target.value } : h) }, true)}
                                                    placeholder="请求头名称" className="min-w-0 w-2/5 rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs" />
                                                <input aria-label="请求头密钥" type="password" value={header.value}
                                                    onChange={event => update(server, { customHeaders: (server.customHeaders || []).map((h, i) => i === headerIndex ? { ...h, value: event.target.value } : h) }, true)}
                                                    placeholder="请求头值" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs" />
                                                <button type="button" aria-label="删除请求头"
                                                    onClick={() => update(server, { customHeaders: (server.customHeaders || []).filter((_, i) => i !== headerIndex) }, true)}
                                                    className="px-2 text-xs text-slate-500">删除</button>
                                            </div>
                                        ))}
                                        <button type="button" onClick={() => update(server, { customHeaders: [...(server.customHeaders || []), { name: '', value: '' }] }, true)}
                                            className="text-[10px] text-slate-600 underline">添加自定义请求头</button>
                                        <div className="flex items-center gap-2">
                                            <button type="button" disabled={!server.url || testing === server.id}
                                                onClick={() => test(server)}
                                                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-[11px] text-slate-700 disabled:opacity-40">
                                                {testing === server.id ? '连接中…' : '测试并读取工具'}
                                            </button>
                                            <span className="text-[10px] text-slate-500">
                                                {ready ? `已发现 ${server.tools?.length} 个工具` : '未连接'}
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </details>
                        {statuses[preset.name] && <p role="status" className="text-[10px] text-slate-600">{statuses[preset.name]}</p>}
                    </div>
                );
            })}
        </div>
    );
};
export default RealtimeMcpPresets;
