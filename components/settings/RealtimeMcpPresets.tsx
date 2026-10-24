import React, { useState } from 'react';
import {
    createMcpServer, loadMcpServers, saveMcpServers, resetMcpSession, testMcpConnection,
    type McpServerConfig,
} from '../../utils/mcpClient';

const PRESETS = [
    {
        name: '电影与剧集 · Orca',
        url: 'https://orca-mcp.mmdju.workers.dev/mcp',
        source: 'https://github.com/mmdju/orca-mcp',
        hint: '公开影视资料服务；无需申请 Key。第三方端点可用性需实际测试。',
    },
    {
        name: 'B站 · 视频搜索',
        url: '',
        source: 'https://github.com/masx200/bilibili-mcp-server',
        hint: '需要按源码部署 Streamable HTTP 服务；没有现成可领取的 Key。',
    },
    {
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
    const persist = (next: McpServerConfig[]) => {
        saveMcpServers(next);
        setServers(next);
        onConfigChanged();
    };
    const add = (preset: typeof PRESETS[number]) => {
        const found = servers.find(s => s.name === preset.name || (!!preset.url && s.url === preset.url));
        if (found) {
            setStatuses(old => ({ ...old, [preset.name]: '已有配置，无需重复添加。' }));
            return;
        }
        persist([...servers, createMcpServer(preset.name, preset.url)]);
    };
    const update = (server: McpServerConfig, patch: Partial<McpServerConfig>, retest = false) => {
        if (retest) resetMcpSession(server.id);
        persist(servers.map(s => s.id === server.id
            ? { ...s, ...patch, ...(retest ? { enabled: false, tools: undefined, lastConnection: undefined } : {}), updatedAt: Date.now() }
            : s));
    };
    const test = async (server: McpServerConfig) => {
        setTesting(server.id);
        setStatuses(old => ({ ...old, [server.name]: '正在测试连接并读取工具…' }));
        try {
            const result = await testMcpConnection(server);
            if (result.ok && result.tools && result.connection) {
                update(server, { tools: result.tools, lastConnection: result.connection });
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
    return (
        <div className="space-y-3">
            <p className="text-xs font-bold text-slate-700">影视与 B站 MCP</p>
            {PRESETS.map(preset => {
                const server = servers.find(s => s.name === preset.name || (!!preset.url && s.url === preset.url));
                const ready = !!server?.tools?.length;
                return (
                    <div key={preset.name} className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-semibold text-slate-800">{preset.name}</span>
                            {!server ? (
                                <button type="button" onClick={() => add(preset)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs">添加</button>
                            ) : (
                                <label className="flex items-center gap-2 text-xs text-slate-600">
                                    <input type="checkbox" checked={!!server.enabled} disabled={!ready}
                                        onChange={e => update(server, { enabled: e.target.checked })} />启用
                                </label>
                            )}
                        </div>
                        <p className="text-[10px] leading-relaxed text-slate-500">{preset.hint}</p>
                        <a href={preset.source} target="_blank" rel="noopener noreferrer"
                            className="inline-block text-[10px] text-slate-700 underline underline-offset-2">
                            原项目 / 获取部署说明 ↗
                        </a>
                        {server && (
                            <>
                                <input aria-label={`${preset.name} MCP 地址`} value={server.url}
                                    onChange={e => update(server, { url: e.target.value.trim() }, true)}
                                    placeholder="填写部署后的 https://…/mcp"
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" />
                                <button type="button" disabled={!server.url || testing === server.id}
                                    onClick={() => test(server)}
                                    className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-[11px] disabled:opacity-40">
                                    {testing === server.id ? '连接中…' : '测试并读取工具'}
                                </button>
                                <span className="ml-2 text-[10px] text-slate-500">{ready ? `已发现 ${server.tools?.length} 个工具` : '未连接'}</span>
                            </>
                        )}
                        {statuses[preset.name] && <p role="status" className="text-[10px] text-slate-600">{statuses[preset.name]}</p>}
                    </div>
                );
            })}
            <p className="text-[10px] text-slate-500">自定义 MCP 服务器请前往「MCP 管理」；这里仅管理已有服务预设。服务器配置和工具调用共用原有 MCP 系统。</p>
        </div>
    );
};
export default RealtimeMcpPresets;
