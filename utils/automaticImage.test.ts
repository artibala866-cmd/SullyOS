// @vitest-environment jsdom
import {beforeEach, expect, it, vi} from 'vitest';
import {readImageSettings, saveImageSettings} from '../components/settings/ImageApiSettingsPanel';
import {deliverAutomaticImage, imagePermission, parseImageDirective, photoInstruction, setImagePermission} from './automaticImage';
import {generateCharacterImage} from './imageGeneration';
import {putImageBlob} from './blobRef';

vi.mock('./imageGeneration', () => ({generateCharacterImage:vi.fn(), imageApiModelsEndpoint:vi.fn()}));
vi.mock('./blobRef', () => ({putImageBlob:vi.fn(), deleteBlobRef:vi.fn()}));
const photo = parseImageDirective('周末的阳光真好。\n[[SEND_PHOTO: 窗边一杯茶]]\n[[PHOTO_SUBJECTS: none]]\n[[PHOTO_PROMPT: tea, window, sunlight]]');
const sender = {id:'char', name:'小茶'};

beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    saveImageSettings({...readImageSettings(), provider:'nai', apiKey:'test', model:'nai-diffusion-4-5-full'});
});

it('keeps visible text and the NovelAI tags separate and strips unfinished controls', () => {
    expect(photo).toMatchObject({text:'周末的阳光真好。',description:'窗边一杯茶',subjects:'none',prompt:'tea, window, sunlight'});
    expect(parseImageDirective('你好\n[[PHOTO_PROMPT: unfinished').text).toBe('你好');
});

it('defaults off and gives each surface independent permission and chat probability', () => {
    expect(photoInstruction('private','char').permission).toBeNull();
    setImagePermission('private','char',true);
    const random = vi.spyOn(Math,'random').mockReturnValue(0.99);
    expect(photoInstruction('private','char').permission).toBeNull();
    random.mockReturnValue(0);
    expect(photoInstruction('private','char').text).toContain('Danbooru');
    expect(photoInstruction('private','char',true).permission).toBeNull();
    expect(photoInstruction('group','char').permission).toBeNull();
    expect(photoInstruction('moments','char').permission).toBeNull();
});

it('never calls the provider when disabled or when the request predates re-enabling', async () => {
    setImagePermission('private','char',true);
    const previous = imagePermission('private','char');
    setImagePermission('private','char',false);
    setImagePermission('private','char',true);
    const commit = vi.fn();
    await expect(deliverAutomaticImage({scope:'private',id:'char',sender,photo,permission:previous,commit})).resolves.toBe(false);
    expect(generateCharacterImage).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
});

it('cancels an in-flight generation when switched off and never stores its late response', async () => {
    setImagePermission('private','char',true);
    let finish!: (blob:Blob)=>void;
    vi.mocked(generateCharacterImage).mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
    const commit = vi.fn();
    const pending = deliverAutomaticImage({scope:'private',id:'char',sender,photo,permission:imagePermission('private','char'),commit});
    const signal = vi.mocked(generateCharacterImage).mock.calls[0][2];
    setImagePermission('private','char',false);
    expect(signal?.aborted).toBe(true);
    finish(new Blob(['test'],{type:'image/png'}));
    await expect(pending).resolves.toBe(false);
    expect(putImageBlob).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
});

it('delivers durable image bytes and sends only the scene tags for scenery on NAI', async () => {
    setImagePermission('moments','char',true);
    vi.mocked(generateCharacterImage).mockResolvedValueOnce(new Blob(['test'],{type:'image/png'}));
    vi.mocked(putImageBlob).mockResolvedValueOnce('blobref:test');
    const commit = vi.fn().mockReturnValue(true);
    await expect(deliverAutomaticImage({scope:'moments',id:'char',sender,photo,permission:imagePermission('moments','char'),commit})).resolves.toBe(true);
    expect(vi.mocked(generateCharacterImage).mock.calls[0][1]).toMatchObject({appearance:'tea, window, sunlight',reference:''});
    expect(commit).toHaveBeenCalledWith('blobref:test','窗边一杯茶',expect.any(AbortSignal));
});

it('reads the latest saved role settings when a chat photo is sent and resolves one person once', async () => {
    const {writeCharacterImageProfile}=await import('./characterImageProfile');
    setImagePermission('group','group',true);
    writeCharacterImageProfile(sender.id,{appearance:'grey hair',reference:'blobref:role-face',facePrompt:'pale eyes',
        referenceEnabled:true,referenceMode:'composition',seed:'17',seedLockEnabled:true});
    vi.mocked(generateCharacterImage).mockResolvedValueOnce(new Blob(['test'],{type:'image/png'}));
    vi.mocked(putImageBlob).mockResolvedValueOnce('blobref:result');
    const delivered=await deliverAutomaticImage({scope:'group',id:'group',sender,known:[sender],
        photo:parseImageDirective('[[SEND_PHOTO: 窗边自拍]] [[PHOTO_SUBJECTS: self,char]] [[PHOTO_PROMPT: window, selfie]]'),
        permission:imagePermission('group','group'),commit:()=>true});
    expect(delivered).toBe(true);
    expect(generateCharacterImage).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({
        appearance:'window, selfie, grey hair',facePrompt:'pale eyes',reference:'blobref:role-face',referenceMode:'composition',seed:'17',
    }),expect.any(AbortSignal),undefined);
});
