import type { APIConfig, CharacterProfile, UserProfile } from '../types';
import { resolveDialogueApi } from './characterApi';
import { loadCharacterContextMessages } from './chatContextRange';
import { normalizeMessageContent } from './messageFormat';
import { ContextBuilder } from './context';
import { readableContextMemories } from './contextMemories';
import { parseLocalDateKey } from './localDate';
import { safeResponseJson } from './safeApi';
import { DB } from './db';
import { dayKey, relationNames, type Bond, type Relation } from './couplesSpace';

export async function readPairDigest(members: string[]) {
  const [groups, scenes, posts] = await Promise.all([DB.getGroups(), DB.getStoryTheaters(), DB.getSocialPosts()]);
  return {
    groups: groups.filter(group => members.every(id => group.members.includes(id))),
    scenes: scenes.filter(scene => members.every(id => scene.characterIds.includes(id))),
    posts: posts.filter(post => post.authorCharId && members.includes(post.authorCharId) &&
      post.comments.some(comment => comment.authorCharId && comment.authorCharId !== post.authorCharId && members.includes(comment.authorCharId))),
  };
}

export async function loadBondMilestoneSources(members: string[]): Promise<NonNullable<Bond['milestones']>> {
  const [{ storyTheaterThreadId }, scenes, actors] = await Promise.all([
    import('./storyTheater'), DB.getStoryTheaters(), Promise.all(members.map(id => DB.getCharacter(id))),
  ]);
  const recentScenes = scenes.filter(scene => members.every(id => scene.characterIds.includes(id))).slice(0, 12);
  const stories = (await Promise.all(recentScenes.map(async scene => {
    const [last] = await DB.getRecentMessagesByCharId(storyTheaterThreadId(scene.id), 1, true);
    const lastArchive = scene.archives?.at(-1);
    const at = last?.timestamp ?? lastArchive?.createdAt;
    return Number.isFinite(at) ? [{ id: `story:${scene.id}`, source: 'story' as const,
      title: scene.title || '共同剧情', date: dayKey(new Date(at!)) }] : [];
  }))).flat();
  const homes = actors.flatMap(actor => (actor?.home3D?.records ?? []).flatMap(record => {
    if (record.kind !== 'action' || record.automatic || !record.text?.trim() || !Number.isFinite(record.at)) return [];
    const belongs = members.length === 1 ? record.actor === 'user' && !record.sharedScene
      : members.every(id => record.sharedScene?.participantIds.includes(id));
    return belongs ? [{ id: `home:${record.id}`, source: 'home' as const,
      title: record.text.trim().slice(0, 100), date: dayKey(new Date(record.at)) }] : [];
  })).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 12);
  return [...new Map([...stories, ...homes].map(item => [item.id, item])).values()];
}

export async function generateBondArtwork(char: CharacterProfile, other: CharacterProfile | UserProfile, relation: Relation, style: string, signal: AbortSignal, pair: boolean) {
  const [{ readImageSettings }, { generateCharacterImage }, { composeCharacterImageScene, readCharacterImageProfile }, { blobToDataUrl }] = await Promise.all([
    import('../components/settings/ImageApiSettingsPanel'), import('./imageGeneration'), import('./characterImageProfile'), import('./blobRef'),
  ]);
  const first = readCharacterImageProfile(char.id);
  const second = 'id' in other ? readCharacterImageProfile(other.id) : {
    appearance: other.imageAppearance ?? '', reference: other.imageReference ?? '', referenceEnabled: !!other.imageLockEnabled,
  };
  const scene = `双人空间封面，两人合照，关系是${relationNames[relation]}，场景风格：${style.trim().slice(0, 500) || '日常'}。`
    + (pair ? '依照两位角色的相处方式自然构图。' : '以两人自然互动为画面中心。');
  const settings = readImageSettings();
  const { profile, references } = composeCharacterImageScene(scene, [{ name: char.name, profile: first }, { name: other.name, profile: second }], settings.provider === 'nai');
  return blobToDataUrl(await generateCharacterImage(settings, profile, signal, references));
}

export async function generateBondPortrait(char: CharacterProfile, pose: string, signal: AbortSignal) {
  const [{ readImageSettings }, { generateCharacterImage }, { readCharacterImageProfile }, { blobToDataUrl }] = await Promise.all([
    import('../components/settings/ImageApiSettingsPanel'), import('./imageGeneration'), import('./characterImageProfile'), import('./blobRef'),
  ]);
  const profile = readCharacterImageProfile(char.id);
  return blobToDataUrl(await generateCharacterImage(readImageSettings(), {
    ...profile, appearance: `单人全身立绘，人物居中，姿势：${pose.trim().slice(0, 400) || '自然站立'}。人物外貌：${profile.appearance}`,
  }, signal));
}

export async function generateBondText(
  char: CharacterProfile, partner: UserProfile, apiConfig: APIConfig, bond: Bond,
  instruction: string, signal: AbortSignal, other?: CharacterProfile, timelineDate?: string,
) {
  const api = resolveDialogueApi(apiConfig, char);
  if (!api.baseUrl || !api.model) throw new Error('请先在设置里配置对话 API');
  const privateRows = other ? [] : await loadCharacterContextMessages(char);
  const pairDigest = other ? await readPairDigest([char.id, other.id]) : undefined;
  const sharedGroups = pairDigest?.groups.slice(0, 3) ?? [];
  const groupRows = (await Promise.all(sharedGroups.map(group => DB.getRecentGroupMessagesWithCount(group.id, 10))))
    .flatMap(result => result.messages).sort((a, b) => a.timestamp - b.timestamp);
  const eligible = [...privateRows, ...groupRows].filter(message => message.role !== 'system' &&
    (!timelineDate || timelineDate === '*' || dayKey(new Date(message.timestamp)) === timelineDate));
  const history = eligible.slice(timelineDate ? -80 : -24).flatMap(message => {
    const text = normalizeMessageContent(message, char.name, partner.name).slice(0, timelineDate ? 700 : 1200);
    if (!text.trim()) return [];
    return [{ role: message.role, content: timelineDate ? `[${dayKey(new Date(message.timestamp))}] ${text}` : text }];
  });
  const supportedDays = new Set(history.flatMap(message => message.content.match(/^\[(\d{4}-\d{2}-\d{2})\]/)?.[1] ?? []));
  const summaries = timelineDate && !other
    ? readableContextMemories(char).daily.flatMap(group => group.entries).flatMap(memory => {
      const match = memory.date.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/);
      if (!match || !memory.summary.trim()) return [];
      const key = [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-');
      return parseLocalDateKey(key) && (timelineDate === '*' || timelineDate === key)
        ? [{ date: key, content: memory.summary.trim().slice(0, 700) }] : [];
    }).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 14) : [];
  for (const summary of summaries) supportedDays.add(summary.date);
  if (timelineDate && !supportedDays.size) throw new Error('所选范围内没有可用于补全的聊天记录或已开放的日度总结');
  if (timelineDate) instruction += '\n只使用这些有资料的日期：' + [...supportedDays].join('、');
  if (summaries.length) instruction += '\n可参考的日度总结：\n' + summaries.map(row => `[${row.date}] ${row.content}`).join('\n');
  const records = bond.entries.filter(item => item.kind !== 'capsule' && item.kind !== 'hollow' &&
    (item.mailMode !== 'postman' || !!item.reply))
    .slice(-12).map(item => `${item.date} ${item.title}：${item.body.slice(0, 260)}`).join('\n');
  const pairContext = other ? (await ContextBuilder.buildCharacterRequest({
    char: other, user: { name: char.name, avatar: char.avatar, bio: '' },
  }, [{ role: 'user', content: instruction }]))[0].content : '';
  const messages = await ContextBuilder.buildCharacterRequest({
    char, user: partner, instructions: [
      `这是双方专属的「情侣空间」。关系定位：${relationNames[bond.relation]}。尊重角色与对方的边界、当前关系进度和资料。`,
      pairContext ? `另一位角色的设定，仅作为背景参考：\n${pairContext}` : '',
      ...(pairDigest?.scenes.slice(0, 5).map(scene => `同场剧情《${scene.title}》：${scene.premise.slice(0, 350)}`) ?? []),
      ...(pairDigest?.posts.slice(0, 5).map(post => `共同 Spark 互动《${post.title}》：${post.content.slice(0, 300)}`) ?? []),
      records ? `已保存的空间资料，仅作为事实参考：\n${records}` : '',
    ].filter(Boolean).join('\n'),
  }, [...history, { role: 'user', content: instruction }]);
  const response = await fetch(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}) },
    body: JSON.stringify({ model: api.model, stream: false, messages, temperature: api.temperature ?? 0.8 }),
  });
  if (!response.ok) throw new Error(`角色请求失败（HTTP ${response.status}）`);
  const data = await safeResponseJson(response);
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('角色没有返回可用内容');
  if (timelineDate) {
    const { extractJson } = await import('./safeApi');
    const parsed = extractJson(text);
    if (!Array.isArray(parsed?.moments)) throw new Error('补全结果格式有误，请重试');
    return JSON.stringify({ moments: parsed.moments.filter((row: Record<string, unknown> | null) => typeof row?.date === 'string' && supportedDays.has(row.date)) });
  }
  return text.trim();
}

export async function detectBondPortraitAnchors(image: HTMLImageElement) {
  const unavailable = '当前浏览器无法自动校准，请改用手动标记';
  const canvas = document.createElement('canvas');
  if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) throw new Error(unavailable);
  let landmarks;
  try {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const root = import.meta.env.BASE_URL;
    const fileset = await FilesetResolver.forVisionTasks(root + 'mediapipe/wasm');
    const detector = await FaceLandmarker.createFromOptions(fileset, {
      canvas, runningMode: 'IMAGE', numFaces: 1,
      baseOptions: { modelAssetPath: root + 'mediapipe/models/face_landmarker.task', delegate: 'CPU' },
    });
    try {
      landmarks = detector.detect(image).faceLandmarks[0];
    } finally { detector.close(); }
  } catch { throw new Error(unavailable); }
  const face = landmarks;
  if (!face?.[152]) throw new Error('没有识别到清晰面部，请手动校准');
  const point = (index: number) => ({
    x: Math.max(0, Math.min(100, face[index].x * 100)),
    y: Math.max(0, Math.min(100, face[index].y * 100)),
  });
  return { 头发: point(10), 脸颊: point(234), 左眼: point(33), 右眼: point(263),
    鼻尖: point(1), 嘴唇: point(13), 下巴: point(152) };
}
