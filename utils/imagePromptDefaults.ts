export const DEFAULT_IMAGE_SCENE_INSTRUCTION = '只有这张照片能自然接住当前话题或角色此刻的生活时才发送。描述角色视角拍到的画面，包含主体、动作、环境、构图和光线。保持出镜人物的稳定外貌，避免凭空编造经历、聊天截图或真实照片。';

export function imagePromptDefaults(provider: 'openai' | 'nai') {
    return provider === 'nai'
        ? {positive: '', negative: 'nsfw, lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing'}
        : {positive: 'cinematic photo, natural light, realistic, high detail', negative: 'low quality, blurry, watermark, text, logo'};
}

export function novelAiQualityPrompt(model: string): string {
    const curated = model.includes('curated');
    if (/4[-_.]?5/i.test(model)) return curated
        ? 'location, masterpiece, no text, -0.8::feet::, rating:general'
        : 'location, very aesthetic, masterpiece, no text';
    if (/nai-diffusion-4/i.test(model)) return curated
        ? 'rating:general, amazing quality, very aesthetic, absurdres'
        : 'no text, best quality, very aesthetic, absurdres';
    return model.includes('furry') ? '{best quality}, {amazing quality}' : 'best quality, amazing quality, very aesthetic, absurdres';
}
