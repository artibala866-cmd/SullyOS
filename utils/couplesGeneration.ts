import type { APIConfig, CharacterProfile, UserProfile } from '../types';
import { resolveDialogueApi } from './characterApi';
import { loadCharacterContextMessages } from './chatContextRange';
import { normalizeMessageContent } from './messageFormat';
import { ContextBuilder } from './context';
import { safeResponseJson } from './safeApi';
import { DB } from './db';
import { relationNames, type Bond, type Relation } from './couplesSpace';

export async function readPairDigest(members: string[]) {
  const [groups, scenes, posts] = await Promise.all([DB.getGroups(), DB.getStoryTheaters(), DB.getSocialPosts()]);
  return {
    groups: groups.filter(group => members.every(id => group.members.includes(id))),
    scenes: scenes.filter(scene => members.every(id => scene.characterIds.includes(id))),
    posts: posts.filter(post => post.authorCharId && members.includes(post.authorCharId) &&
      post.comments.some(comment => comment.authorCharId && comment.authorCharId !== post.authorCharId && members.includes(comment.authorCharId))),
  };
}

export async function generateBondArtwork(char: CharacterProfile, other: CharacterProfile | UserProfile, relation: Relation, style: string, signal: AbortSignal, pair: boolean) {
  const [{ readImageSettings }, { generateCharacterImage }, { readCharacterImageProfile }, { blobToDataUrl }] = await Promise.all([
    import('../components/settings/ImageApiSettingsPanel'), import('./imageGeneration'), import('./characterImageProfile'), import('./blobRef'),
  ]);
  const first = readCharacterImageProfile(char.id);
  const second = 'id' in other ? readCharacterImageProfile(other.id) : {
    appearance: other.imageAppearance ?? '', reference: other.imageReference ?? '', referenceEnabled: !!other.imageLockEnabled,
  };
  const appearance = [
    `双人空间封面，两人合照，关系是${relationNames[relation]}，场景风格：${style.trim().slice(0, 500) || '日常'}。`,
    `${char.name}：${first.appearance}`, `${other.name}：${second.appearance}`,
    pair ? '依照两位角色的相处方式自然构图。' : '以两人自然互动为画面中心。',
  ].join(' ');
  const references = [{ name: char.name, profile: first }, { name: other.name, profile: second }]
    .filter(({ profile }) => profile.referenceEnabled !== false && profile.reference)
    .map(({ name, profile }) => ({ name, value: profile.reference }));
  return blobToDataUrl(await generateCharacterImage(readImageSettings(), { appearance, facePrompt: '', reference: '' }, signal, references));
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
  instruction: string, signal: AbortSignal, other?: CharacterProfile,
) {
  const api = resolveDialogueApi(apiConfig, char);
  if (!api.baseUrl || !api.model) throw new Error('请先在设置里配置对话 API');
  const privateRows = other ? [] : (await loadCharacterContextMessages(char)).slice(-24);
  const pairDigest = other ? await readPairDigest([char.id, other.id]) : undefined;
  const sharedGroups = pairDigest?.groups.slice(0, 3) ?? [];
  const groupRows = (await Promise.all(sharedGroups.map(group => DB.getRecentGroupMessagesWithCount(group.id, 10))))
    .flatMap(result => result.messages).sort((a, b) => a.timestamp - b.timestamp);
  const history = [...privateRows, ...groupRows].map(message => ({
    role: message.role, content: normalizeMessageContent(message, char.name, partner.name).slice(0, 1200),
  })).filter(message => message.role !== 'system' && message.content.trim());
  const records = bond.entries.filter(item => item.kind !== 'capsule' && item.kind !== 'hollow')
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
  return text.trim();
}
