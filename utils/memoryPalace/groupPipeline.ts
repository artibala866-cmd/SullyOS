/**
 * Group Memory Palace — 群聊后台总结管线
 *
 * 与私聊管线（pipeline.ts/processNewMessages）的关系：**完全平行、互不调用**。
 * 所有共享的只是底层 IndexedDB 表（memory_nodes / memory_vectors 等通用 CRUD）和
 * embedding/向量存储工具。私聊代码一行不动。
 *
 * 核心数据流：
 * 1. 群聊导演响应后，GroupChat fire-and-forget 调用 processGroupNewMessages
 * 2. 检查群聊高水位线（per-groupId localStorage key），缓冲区超 BUFFER_THRESHOLD_GROUP 才触发
 * 3. LLM 用第三人称提取群记忆草稿（groupExtraction.extractGroupMemoriesFromBuffer）
 * 4. 每个成员各持久化一份（同样的草稿，charId=member.id，附 groupId/groupName 字段）
 *    → 私聊里 retrieveMemories(member.id) 自然能召回这条群记忆，**无需额外注入路径**
 * 5. 更新群聊高水位线
 *
 * 删除群时，调用 deleteGroupMemoriesByGroupId 清理所有相关记忆。
 */
import type { Message, CharacterProfile, GroupProfile } from '../../types';
import type { EmbeddingConfig, MemoryNode, RemoteVectorConfig, MemoryVector } from './types';
import type { LightLLMConfig } from './pipeline';
import { DB } from '../db';
import { MemoryNodeDB, MemoryVectorDB, ensureFloat32 } from './db';
import { getEmbeddings, cosineSimilarity } from './embedding';
import { extractGroupMemoriesFromBuffer } from './groupExtraction';
import { isMessageSemanticallyRelevant } from '../messageFormat';

// ─── 群聊水位线：私聊用 200/100，群聊更宽松 300/200 ─────────────────
const HOT_ZONE_SIZE_GROUP = 300;
// export：群设置的成员记忆状态面板文案里引用「满 N 条自动触发」，不硬编码
export const BUFFER_THRESHOLD_GROUP = 200;
const PROCESS_RATIO = 0.85;
const DEDUP_THRESHOLD = 0.9;

const LAST_MSG_KEY_GROUP = (groupId: string) => `mp_lastMsgId_group_${groupId}`;

function getLastProcessedGroupId(groupId: string): number {
    try {
        const val = parseInt(localStorage.getItem(LAST_MSG_KEY_GROUP(groupId)) || '0', 10);
        return isNaN(val) || val < 0 ? 0 : val;
    } catch { return 0; }
}

function setLastProcessedGroupId(groupId: string, msgId: number): void {
    try { localStorage.setItem(LAST_MSG_KEY_GROUP(groupId), String(msgId)); } catch {}
}

/** 对外只读包装：群记忆宫殿处理到的最后一条消息 id（成员记忆状态面板展示进度用） */
export function getGroupMemoryPalaceHighWaterMark(groupId: string): number {
    return getLastProcessedGroupId(groupId);
}

/** 全局记忆宫殿配置（自己读 localStorage，不调 pipeline.ts 的私有 getter） */
function readGlobalMemoryPalaceConfig(): {
    embedding?: EmbeddingConfig;
    lightLLM?: LightLLMConfig;
} {
    try {
        const raw = localStorage.getItem('os_memory_palace_config');
        if (!raw) return {};
        const cfg = JSON.parse(raw);
        return {
            embedding: cfg?.embedding?.baseUrl && cfg?.embedding?.apiKey ? cfg.embedding as EmbeddingConfig : undefined,
            lightLLM: cfg?.lightLLM?.baseUrl && cfg?.lightLLM?.apiKey ? cfg.lightLLM as LightLLMConfig : undefined,
        };
    } catch {
        return {};
    }
}

function readRemoteVectorConfig(): RemoteVectorConfig | undefined {
    try {
        const raw = localStorage.getItem('os_remote_vector_config');
        if (!raw) return undefined;
        const config = JSON.parse(raw) as RemoteVectorConfig;
        return (config.enabled && config.initialized) ? config : undefined;
    } catch { return undefined; }
}

/**
 * 用成员的 embedding 配置（如果该成员有覆盖），否则用全局配置。
 * 任何 member 没配 → 返回 null，调用方跳过该成员。
 */
function getEmbeddingConfigForMember(member: CharacterProfile, fallbackGlobal?: EmbeddingConfig): EmbeddingConfig | null {
    const charEmb = (member as any).embeddingConfig;
    if (charEmb?.baseUrl && charEmb?.apiKey) {
        return charEmb as EmbeddingConfig;
    }
    return fallbackGlobal || null;
}

function generateGroupMemoryId(): string {
    return `mng_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 把消息按 charId 映射成显示名（用户消息 → userName，角色消息 → 角色名） */
function makeSpeakerNameOf(members: CharacterProfile[], userName: string) {
    const charIdToName = new Map<string, string>();
    for (const m of members) charIdToName.set(m.id, m.name);
    return (msg: Message): string => {
        if (msg.role === 'user') return userName || '用户';
        if (msg.charId) return charIdToName.get(msg.charId) || '群友';
        return '群友';
    };
}

// ─── 并发锁：每个群同时只跑一个处理任务 ─────────────────
const processingLocks = new Set<string>();
// 解散群时先标记终止，拦住已经发出网络请求、稍后才回来的旧同步任务。
const deletedGroups = new Set<string>();

/**
 * 删除某个群的所有群记忆（成员各自存的副本一并清掉）
 *
 * 群被删除时调用：扫描全表，删除 groupId 匹配的 MemoryNode + 对应 MemoryVector。
 * 全表扫不快但删群是低频操作，可接受。
 */
export async function deleteGroupMemoriesByGroupId(groupId: string): Promise<{ deleted: number }> {
    if (!groupId) return { deleted: 0 };
    deletedGroups.add(groupId);
    try { localStorage.removeItem(LAST_MSG_KEY_GROUP(groupId)); } catch { /* storage blocked */ }
    try {
        const all = await (async () => {
            // MemoryNodeDB 没有 getAll；走通用 db 表名直查
            const db = await (await import('../db')).openDB();
            return new Promise<MemoryNode[]>((resolve, reject) => {
                const tx = db.transaction('memory_nodes', 'readonly');
                const req = tx.objectStore('memory_nodes').getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        })();
        const targets = all.filter(n => n.groupId === groupId);
        if (targets.length === 0) return { deleted: 0 };
        // 先尽力清理远端 pgvector，避免仅删除 IndexedDB 却留下可检索副本。
        // 远端不可用也要继续删除本地；孤儿群记忆由 vectorSearch 的来源校验拦截。
        const remote = readRemoteVectorConfig();
        if (remote) {
            try {
                const { deleteVector } = await import('./supabaseVector');
                let failed = 0;
                for (let i = 0; i < targets.length; i += 8) {
                    const batch = targets.slice(i, i + 8);
                    const outcomes = await Promise.all(batch.map(node => deleteVector(remote, node.id)));
                    failed += outcomes.filter(ok => !ok).length;
                }
                if (failed) console.warn(`[GroupPalace] 群 ${groupId} 远程向量删除失败 ${failed} 条；本地继续删除`);
            } catch (error) {
                console.warn('[GroupPalace] 远程群记忆清理失败，本地继续删除:', error);
            }
        }
        for (const node of targets) {
            try {
                await MemoryNodeDB.delete(node.id);
                // 对应向量也删掉
                await MemoryVectorDB.delete(node.id);
            } catch (e: any) {
                console.warn(`🗑️ [GroupPalace] 删除节点 ${node.id} 失败: ${e.message}`);
            }
        }
        console.log(`🗑️ [GroupPalace] 删除群 ${groupId} 的群记忆 ${targets.length} 条`);
        return { deleted: targets.length };
    } catch (e: any) {
        console.warn(`🗑️ [GroupPalace] 清理群记忆失败: ${e.message}`);
        return { deleted: 0 };
    }
}

/**
 * 群聊后台缓冲区处理。
 *
 * - 至少需要 1 个成员开启了记忆宫殿才跑（否则直接 return null）
 * - 全程异常吞掉，console.warn 后返回 null，绝不影响 GroupChat 主流程
 * - 写出来的 MemoryNode 自带 groupId/groupName，私聊代码读到这俩字段不感知（无副作用）
 * - onProgress 回调：每进入一个关键阶段触发一次（"扫描缓冲区" / "LLM 提取中" / "向量化第 X 个成员"），
 *   caller 用它做 toast/状态条等用户可见提示。skip 路径（hot_zone/threshold）**不触发** onProgress，
 *   避免水位线没到时也弹"在整理"造成误导。
 */
export async function processGroupNewMessages(
    group: GroupProfile,
    members: CharacterProfile[],
    userName: string,
    onProgress?: (stage: string) => void,
): Promise<{
    stored: number;
    perMemberStored: Record<string, number>;
    /** drafts 数量（即从 LLM 提取出的群记忆条数；可能 ≥ stored，因为 dedup 会扣掉一些） */
    extracted?: number;
    /** 本轮处理的群消息条数（用于 result toast 显示信息量） */
    processedMessageCount?: number;
    reason?: 'lock' | 'hot_zone' | 'threshold' | 'no_config' | 'no_enabled_member' | 'sync_disabled' | 'group_deleted' | 'members_changed';
} | null> {
    if (!group?.id) return null;
    if (deletedGroups.has(group.id)) return { stored: 0, perMemberStored: {}, reason: 'group_deleted' };
    const lockKey = group.id;
    if (processingLocks.has(lockKey)) {
        return { stored: 0, perMemberStored: {}, reason: 'lock' };
    }
    processingLocks.add(lockKey);

    try {
        // 私聊互通是双向授权；关闭后不再把群记录写入个人记忆宫殿。
        // 以数据库最新群资料为准，避免异步提取期间撤销授权后仍写入。
        const latestGroup = (await DB.getGroups()).find(item => item.id === group.id);
        if (!latestGroup || deletedGroups.has(group.id)) return { stored: 0, perMemberStored: {}, reason: 'group_deleted' };
        if (latestGroup.privateChatSyncEnabled === false) {
            return { stored: 0, perMemberStored: {}, reason: 'sync_disabled' };
        }

        // 1. 至少要有一个成员开启了记忆宫殿
        const enabledMembers = members.filter(m => m.memoryPalaceEnabled && latestGroup.members.includes(m.id));
        if (enabledMembers.length === 0) {
            return { stored: 0, perMemberStored: {}, reason: 'no_enabled_member' };
        }

        // 2. 解析全局 LLM/embedding 配置（每个成员可能各自覆盖 embedding）
        const globalCfg = readGlobalMemoryPalaceConfig();
        const lightLLM = globalCfg.lightLLM;
        const globalEmb = globalCfg.embedding;
        if (!lightLLM) {
            console.warn(`🏰 [GroupPalace] 群 ${group.name} 没有可用的 lightLLM 配置，跳过`);
            return { stored: 0, perMemberStored: {}, reason: 'no_config' };
        }

        // 3. 加载群消息 → 计算热区 / 缓冲区
        const allMsgs = await DB.getGroupMessages(group.id);
        const textMsgs = allMsgs
            .filter(isMessageSemanticallyRelevant)
            .sort((a, b) => a.id - b.id);

        const totalCount = textMsgs.length;
        if (totalCount <= HOT_ZONE_SIZE_GROUP) {
            console.log(`🏰 [GroupPalace] 群 ${group.name}：消息总数 ${totalCount} <= 热区 ${HOT_ZONE_SIZE_GROUP}，无需处理`);
            return { stored: 0, perMemberStored: {}, reason: 'hot_zone' };
        }

        const hotZoneStartIdx = totalCount - HOT_ZONE_SIZE_GROUP;
        const hotZoneStartId = textMsgs[hotZoneStartIdx].id;

        const lastProcessedId = getLastProcessedGroupId(group.id);
        const buffer = textMsgs.filter(m => m.id > lastProcessedId && m.id < hotZoneStartId);

        if (buffer.length < BUFFER_THRESHOLD_GROUP) {
            console.log(`🏰 [GroupPalace] 群 ${group.name}：缓冲区 ${buffer.length} < ${BUFFER_THRESHOLD_GROUP}，跳过（hwm=${lastProcessedId}, 热区起点 id=${hotZoneStartId}）`);
            return { stored: 0, perMemberStored: {}, reason: 'threshold' };
        }

        // 4. 取前 85%
        const processCount = Math.ceil(buffer.length * PROCESS_RATIO);
        const toProcess = buffer.slice(0, processCount);
        const keptTail = buffer.length - processCount;
        if (toProcess.length === 0) return { stored: 0, perMemberStored: {}, reason: 'threshold' };

        console.log(`🏰 [GroupPalace] 群 ${group.name}：开始处理 ${toProcess.length} 条群消息（保留尾部 ${keptTail} 条）`);
        onProgress?.(`正在整理 ${toProcess.length} 条群消息...`);

        // 5. LLM 提取（第三人称草稿）
        const memberNames = members.map(m => m.name);
        const speakerNameOf = makeSpeakerNameOf(members, userName);
        onProgress?.(`正在提取【${group.name}】群记忆...`);
        const { drafts } = await extractGroupMemoriesFromBuffer(
            toProcess,
            group.name,
            memberNames,
            userName || '用户',
            speakerNameOf,
            lightLLM,
        );

        if (drafts.length === 0) {
            console.warn(`🏰 [GroupPalace] 群 ${group.name}：提取 0 条群记忆，不更新水位线，下次重试`);
            return { stored: 0, perMemberStored: {}, extracted: 0, processedMessageCount: toProcess.length };
        }

        console.log(`🏰 [GroupPalace] 群 ${group.name}：提取 ${drafts.length} 条群记忆，开始为 ${enabledMembers.length} 个成员各持久化一份`);
        onProgress?.(`提取到 ${drafts.length} 条群记忆，正在向量化并存入 ${enabledMembers.length} 个成员的记忆宫殿...`);

        // 提取时群可能已被删除/取消互通/成员退群；绝不使用过期授权继续写个人记忆。
        const currentGroup = (await DB.getGroups()).find(item => item.id === group.id);
        if (!currentGroup || deletedGroups.has(group.id)) return { stored: 0, perMemberStored: {}, reason: 'group_deleted' };
        if (currentGroup.privateChatSyncEnabled === false) {
            return { stored: 0, perMemberStored: {}, reason: 'sync_disabled' };
        }

        // 6. 为每个开启记忆宫殿的成员各存一份
        //    每个成员用 ta 自己的 embedding 配置——这样 retrieve 时向量空间一致
        const perMemberStored: Record<string, number> = {};
        const remoteVectorCfg = readRemoteVectorConfig();
        let totalStored = 0;
        let allMembersCompleted = true;

        for (const member of enabledMembers) {
            // 取消授权/解散/退出群后立即止损，避免延迟的 embedding 请求写入旧群记忆。
            const latest = (await DB.getGroups()).find(item => item.id === group.id);
            const freshCharacter = (await DB.getAllCharacters()).find(item => item.id === member.id);
            if (!latest || deletedGroups.has(group.id) || latest.privateChatSyncEnabled === false) {
                return { stored: totalStored, perMemberStored, reason: latest ? 'sync_disabled' : 'group_deleted' };
            }
            if (!latest.members.includes(member.id) || !freshCharacter?.memoryPalaceEnabled) {
                allMembersCompleted = false;
                continue;
            }
            const memberEmb = getEmbeddingConfigForMember(freshCharacter, globalEmb);
            if (!memberEmb) {
                console.warn(`🏰 [GroupPalace] 成员 ${member.name} 没有 embedding 配置，跳过 ta 这一份`);
                perMemberStored[member.id] = 0;
                allMembersCompleted = false;
                continue;
            }

            try {
                // 6a. 这个成员现有向量（用于本批去重）
                const [allMemberVectors, allMemberNodes] = await Promise.all([
                    MemoryVectorDB.getAllByCharId(member.id),
                    MemoryNodeDB.getByCharId(member.id),
                ]);
                // 只拿本群的记忆去重。另一群的共同经历、甚至私聊的相似记忆
                // 绝不能阻止当前群写下自己的事实及群来源。
                const groupMemoryIds = new Set(allMemberNodes.filter(node => node.groupId === group.id).map(node => node.id));
                const existingVectors = allMemberVectors.filter(vector => groupMemoryIds.has(vector.memoryId));

                // 6b. 嵌入这个成员的所有 drafts
                const texts = drafts.map(d => d.content);
                const vectors = await getEmbeddings(texts, memberEmb);

                let storedForMember = 0;
                for (let i = 0; i < drafts.length; i++) {
                    const draft = drafts[i];
                    const vector = vectors[i];

                    // 与该成员已有记忆去重（同样的群记忆草稿可能跟以前的群记忆撞）
                    // ev.vector 声明上有 number[] / Float32Array / Uint8Array 三态，
                    // ensureFloat32 统一（DB 层已经转好，这里是恒等返回），别让
                    // cosineSimilarity 把 Uint8Array 的原始字节当成分量读。
                    const duplicate = existingVectors.find(ev => cosineSimilarity(vector, ensureFloat32(ev.vector)) > DEDUP_THRESHOLD);
                    if (duplicate) {
                        // 之前本地已存，但远端当时写入失败：重试同步相同的源节点，
                        // 不能只因本地去重成功就永久丢失这份云端召回。
                        if (remoteVectorCfg?.enabled && remoteVectorCfg.initialized) {
                            const existingNode = await MemoryNodeDB.getById(duplicate.memoryId);
                            if (existingNode?.groupId === group.id) {
                                try {
                                    const { upsertVector } = await import('./supabaseVector');
                                    const ok = await upsertVector(remoteVectorCfg, existingNode.id, member.id,
                                        duplicate.vector, existingNode, memberEmb.dimensions, memberEmb.model);
                                    if (!ok) allMembersCompleted = false;
                                } catch {
                                    allMembersCompleted = false;
                                }
                            }
                        }
                        console.log(`♻️ [GroupPalace] ${member.name}：重复群记忆跳过 "${draft.content.slice(0, 30)}..."`);
                        continue;
                    }

                    const node: MemoryNode = {
                        id: generateGroupMemoryId(),
                        charId: member.id,
                        content: draft.content,
                        room: draft.room,
                        tags: draft.tags,
                        importance: draft.importance,
                        mood: draft.mood,
                        valence: draft.valence,
                        arousal: draft.arousal,
                        embedded: true,
                        createdAt: draft.createdAt,
                        lastAccessedAt: draft.createdAt,
                        accessCount: 0,
                        eventBoxId: null,
                        origin: 'extraction',
                        groupId: group.id,
                        groupName: group.name,
                    };
                    const memVec: MemoryVector = {
                        memoryId: node.id,
                        charId: member.id,
                        vector,
                        dimensions: memberEmb.dimensions,
                        model: memberEmb.model,
                    };
                    // 节点 + 向量同事务落库；避免向量保存失败后遗留无向量的孤儿记忆。
                    await MemoryNodeDB.saveVectorizedMany([{ node, vector: memVec }]);

                    // 云端启用时确认向量写入，失败不推进群游标；
                    // 下轮会凭本地去重找到同一节点继续补发，避免云端漏记。
                    if (remoteVectorCfg?.enabled && remoteVectorCfg.initialized) {
                        try {
                            const { upsertVector } = await import('./supabaseVector');
                            const ok = await upsertVector(remoteVectorCfg, node.id, member.id,
                                vector, node, memberEmb.dimensions, memberEmb.model);
                            if (!ok) allMembersCompleted = false;
                        } catch {
                            allMembersCompleted = false;
                        }
                    }

                    existingVectors.push(memVec);
                    storedForMember++;
                }

                perMemberStored[member.id] = storedForMember;
                totalStored += storedForMember;
                console.log(`🏰 [GroupPalace] ${member.name}：存入 ${storedForMember} 条群记忆`);
            } catch (e: any) {
                console.warn(`🏰 [GroupPalace] ${member.name} 持久化群记忆失败: ${e.message}（其他成员继续）`);
                perMemberStored[member.id] = 0;
                allMembersCompleted = false;
            }
        }

        // 7. 所有仍在群内、已启用记忆的成员都成功（含去重）后才能推进群水位。
        // 部分成员失败不可跳过，否则他们永远追不上旧群记录。
        const finalGroup = (await DB.getGroups()).find(item => item.id === group.id);
        if (!finalGroup || deletedGroups.has(group.id) || finalGroup.privateChatSyncEnabled === false) {
            return { stored: totalStored, perMemberStored, reason: finalGroup ? 'sync_disabled' : 'group_deleted' };
        }
        if (allMembersCompleted) {
            const newHighWaterMark = toProcess[toProcess.length - 1].id;
            setLastProcessedGroupId(group.id, newHighWaterMark);
            console.log(`✅ [GroupPalace] 群 ${group.name}：处理完成 ${totalStored} 条总入库, hwm ${lastProcessedId} → ${newHighWaterMark}`);
        } else {
            console.warn(`🏰 [GroupPalace] 群 ${group.name}：部分成员未完成，本次不更新水位线，后续靠去重重试`);
        }

        return {
            stored: totalStored,
            perMemberStored,
            extracted: drafts.length,
            processedMessageCount: toProcess.length,
        };
    } catch (e: any) {
        console.warn(`❌ [GroupPalace] 群 ${group.name} 处理失败: ${e.message}`);
        return null;
    } finally {
        processingLocks.delete(lockKey);
    }
}
