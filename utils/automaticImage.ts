import {createLocalId} from './localId';
import type {UserProfile} from '../types';
import {readImageSettings} from '../components/settings/ImageApiSettingsPanel';
import {deleteBlobRef, putImageBlob} from './blobRef';
import {readCharacterImageProfile} from './characterImageProfile';
import {generateCharacterImage} from './imageGeneration';
import {DEFAULT_IMAGE_SCENE_INSTRUCTION} from './imagePromptDefaults';

export type ImageScope = 'private' | 'group' | 'moments';
export const IMAGE_PERMISSION_CHANGED = 'sully:automatic-image-permission';
const key = (scope: ImageScope, id: string) => `sully_automatic_image:${scope}:${id}`;

export function imagePermission(scope: ImageScope, id: string): string | null {
    try {
        const value = localStorage.getItem(key(scope, id));
        return value?.startsWith('on:') ? value : null;
    } catch { return null; }
}

export function setImagePermission(scope: ImageScope, id: string, enabled: boolean) {
    if (enabled) localStorage.setItem(key(scope, id), 'on:' + createLocalId());
    else localStorage.removeItem(key(scope, id));
    window.dispatchEvent(new Event(IMAGE_PERMISSION_CHANGED));
}

const photoFields = /\[\[\s*(SEND_PHOTO|SEND_IMAGE|PHOTO|PHOTO_SUBJECTS|PHOTO_PROMPT|PHOTO_TURN)\s*[:：]\s*([^\]\r\n]*)\]\]/gi;

export function parseImageDirective(raw: string) {
    let description = '', subjects = '', prompt = '', turn = '';
    const text = raw.replace(photoFields, (_all, kind: string, value: string) => {
        switch (kind.toUpperCase()) {
            case 'PHOTO_SUBJECTS': subjects ||= value.trim().slice(0, 350); break;
            case 'PHOTO_TURN': turn ||= value.trim().slice(0, 80); break;
            case 'PHOTO_PROMPT': prompt ||= value.trim().slice(0, 1200); break;
            default: description ||= value.trim().slice(0, 350);
        }
        return '';
    }).replace(/\[\[\s*(?:SEND_PHOTO|SEND_IMAGE|PHOTO|PHOTO_SUBJECTS|PHOTO_PROMPT|PHOTO_TURN)(?:\s*[:：][^\r\n]*)?$/gi, '').trim();
    return {text, description, subjects, prompt, turn};
}

export function photoInstruction(scope: ImageScope, id: string, recentPhoto = false, cloud = false) {
    const permission = imagePermission(scope, id);
    const config = readImageSettings();
    const enabled = !!permission && !!config.apiKey.trim() && !!config.model.trim() && !recentPhoto
        && (scope === 'moments' || Math.random() < 0.25);
    const tag = scope === 'moments' ? 'PHOTO' : 'SEND_PHOTO';
    if (!enabled) return {permission: null, text: '\n本轮只按现有聊天格式回复，禁止生成照片、图片链接或任何照片指令。'};
    return {permission, text: `\n【本轮可选照片】${config.sceneInstruction ?? DEFAULT_IMAGE_SCENE_INSTRUCTION}
只有确实要发图时，另起一行写 [[${tag}: 简短、可读的画面描述]]，再写 [[PHOTO_SUBJECTS: self]]（发图者）、user（用户）、self,user（合照）、已知角色 ID，或 none（风景、物品或身份未知）。不要猜测 ID。
${config.provider === 'nai' ? '另写 [[PHOTO_PROMPT: 一行英文逗号分隔的 NovelAI / Danbooru tags]]，只写构图、服装、表情、动作、场景和光线。不要写画师、质量、负面词、完整句子或改写已知人物的稳定外貌。' : '使用自然语言描述画面，不输出 PHOTO_PROMPT。'}
${cloud ? `把照片描述、人物标记、英文标签（如需要）和 [[PHOTO_TURN: ${permission}]] 全部放在同一行，正文另起一行。` : ''}
保持原有回复结构。JSON 回复把标记放进该条自己的正文字符串里。不要输出图片链接。旧世界书规则若与照片格式冲突，以本轮格式为准。`};
}

type PhotoOwner = {id: string; name: string};
export async function deliverAutomaticImage(options: {
    scope: ImageScope; id: string; permission: string | null;
    photo: ReturnType<typeof parseImageDirective>; sender: PhotoOwner; user?: UserProfile;
    known?: PhotoOwner[]; signal?: AbortSignal;
    commit: (token: string, description: string, signal: AbortSignal) => boolean | Promise<boolean>;
}): Promise<boolean> {
    const {scope, id, permission, photo, sender, user, known = [], signal, commit} = options;
    const active = () => !!permission && imagePermission(scope, id) === permission && !signal?.aborted;
    if (!active() || !photo.description) return false;
    const config = readImageSettings();
    if (!config.apiKey.trim() || !config.model.trim()) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    const cancel = () => { if (!active()) controller.abort(); };
    signal?.addEventListener('abort', cancel);
    window.addEventListener(IMAGE_PERMISSION_CHANGED, cancel);
    window.addEventListener('storage', cancel);
    let token: string | undefined;
    let saved = false;
    try {
        const subjects = [...new Set(photo.subjects.toLowerCase().split(/[,，]/).map(x => x.trim()))];
        const people = subjects.flatMap(subject => {
            if (subject === 'user' && user) return [{name: user.name || 'User', profile: {
                appearance: user.imageAppearance || '', reference: user.imageReference || '', referenceEnabled: !!user.imageLockEnabled,
            }}];
            const owner = subject === 'self' ? sender : known.find(person => person.id.toLowerCase() === subject);
            return owner ? [{name: owner.name, profile: readCharacterImageProfile(owner.id)}] : [];
        });
        const single = people.length === 1 ? people[0].profile : undefined;
        const scene = config.provider === 'nai' && photo.prompt ? photo.prompt : photo.description;
        const appearances = people.map(({name, profile}) => {
            const look = [profile.appearance, 'facePrompt' in profile && profile.facePrompt].filter(Boolean).join(', ');
            return look && config.provider === 'openai' ? `${name}: ${look}` : look;
        }).filter(Boolean);
        const references = people.filter(({profile}) => profile.referenceEnabled !== false && profile.reference)
            .map(({name, profile}) => ({name, value: profile.reference}));
        const blob = await generateCharacterImage(config, {
            ...single, appearance: [scene, ...appearances].join(', '), facePrompt: '',
            reference: single?.reference ?? '',
        }, controller.signal, people.length > 1 ? references : undefined);
        if (!active() || controller.signal.aborted) return false;
        token = await putImageBlob(blob);
        if (!active() || controller.signal.aborted) return false;
        saved = await commit(token, photo.description, controller.signal);
        return saved;
    } catch (error) {
        if (active()) console.warn('[Automatic image] generation or delivery failed', error);
        return false;
    } finally {
        if (token && !saved) await deleteBlobRef(token).catch(() => {});
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
        window.removeEventListener(IMAGE_PERMISSION_CHANGED, cancel);
        window.removeEventListener('storage', cancel);
    }
}
