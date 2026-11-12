/**
 * The nine optional presets from the user-supplied offline Text Alchemist.
 * These are never installed automatically; an explicit selection is required.
 * The names, regex patterns and author HTML/prompts remain source-defined.
 */
export const ALCHEMY_REFERENCE_REGEX_PRESETS = [
    { name: '隱藏 think 思維鏈', pattern: '<think(?:ing)?>[\\s\\S]*?<\\/think(?:ing)?>', flags: 'gi', replacement: '', scope: 'global',
        scenes: ['chat', 'moments', 'forum'], role: 'ai', applyOnDisplay: 1, applyOnPrompt: 1, trim: 1 },
    { name: 'AI 免責聲明過濾', pattern: '作為(一個|一名)?(AI|人工智能|語言模型|大型語言模型)[^。！？]*[。！？]', flags: 'g', replacement: '',
        scope: 'global', scenes: ['chat'], role: 'ai', applyOnDisplay: 1, applyOnPrompt: 0 },
    { name: '隱藏 OOC 註解', pattern: '[（(]\\s*(OOC|Note)\\s*[:：][^)）]*[）)]', flags: 'gi', replacement: '',
        scope: 'global', scenes: ['chat'], role: 'both', applyOnDisplay: 1, applyOnPrompt: 1 },
    { name: '括號動作轉星號', pattern: '[（(]([^()（）]{1,40})[）)]', flags: 'g', replacement: '*$1*',
        scope: 'global', scenes: ['chat'], role: 'ai', applyOnDisplay: 1, applyOnPrompt: 0 },
    { name: '直引號轉中文引號', pattern: '"([^"\\n]+)"', flags: 'g', replacement: '「$1」',
        scope: 'global', scenes: ['chat'], role: 'both', applyOnDisplay: 1, applyOnPrompt: 0 },
] as const;

export const ALCHEMY_REFERENCE_HTML_PRESETS = [
    { name: '心情狀態欄', isHtmlTemplate: true, pattern: '<status>([\\s\\S]*?)<\\/status>', flags: 'g', parseMode: 'kv',
        htmlTemplate: '<div class="rg-status-card">\n  <span class="rg-status-item">心情：{{1.心情}}</span>\n  <span class="rg-status-item">時間：{{1.時間}}</span>\n  <span class="rg-status-item">地點：{{1.地點}}</span>\n</div>',
        cssScope: '.rg-status-card{display:flex;gap:8px;flex-wrap:wrap;padding:6px 10px;background:rgba(0,0,0,.06);border-radius:8px;font-size:12px;margin:4px 0}\n.rg-status-item{opacity:.85}',
        aiPrompt: 'Before your reply, output ONE status line in this exact format:\n<status>心情:XX|時間:XX|地點:XX</status>\n\nRules:\n- 心情 = your current mood (1-2 zh chars)\n- 時間 = current in-story time (e.g. 下午3點)\n- 地點 = current location\n- Use full-width colon ":" or half-width — both OK\n- Separator must be "|"\n- Output the tag ONCE per reply, then continue normally',
        scope: 'global', scenes: ['chat'], role: 'ai', applyOnDisplay: 1, applyOnPrompt: 0 },
    { name: '心聲卡片', isHtmlTemplate: true, pattern: '<心聲>([\\s\\S]*?)<\\/心聲>', flags: 'g', parseMode: 'text',
        htmlTemplate: '<div class="rg-inner-voice">💭 {{$1}}</div>',
        cssScope: '.rg-inner-voice{padding:8px 12px;background:rgba(0,0,0,.04);border-left:3px solid #888;border-radius:6px;font-style:italic;margin:6px 0;color:#666}',
        aiPrompt: "When you have an internal thought your character would NOT say out loud, wrap it like:\n<心聲>actual inner thought here</心聲>\n\n- Place it BEFORE the spoken/action text\n- Keep it short (1 sentence)\n- Use sparingly — only when there's a real gap between thought and action\n- Skip the tag entirely when not needed",
        scope: 'global', scenes: ['chat'], role: 'ai', applyOnDisplay: 1, applyOnPrompt: 0 },
    { name: '好感度進度條', isHtmlTemplate: true, pattern: '<affection>([\\s\\S]*?)<\\/affection>', flags: 'g', parseMode: 'kv',
        htmlTemplate: '<div class="rg-aff-card">\n  <div class="rg-aff-name">{{1.對象}}</div>\n  <div class="rg-aff-bar"><div class="rg-aff-fill" style="width:{{1.值}}%"></div></div>\n  <div class="rg-aff-num">{{1.值}}/100</div>\n</div>',
        cssScope: '.rg-aff-card{display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(0,0,0,.04);border-radius:6px;font-size:12px;margin:4px 0}\n.rg-aff-name{font-weight:700}\n.rg-aff-bar{flex:1;height:6px;background:rgba(0,0,0,.12);border-radius:3px;overflow:hidden}\n.rg-aff-fill{height:100%;background:#222;transition:width .3s}\n.rg-aff-num{font-family:monospace;opacity:.7}',
        aiPrompt: "When character relationship value changes meaningfully, output:\n<affection>對象:用戶名|值:0-100整數</affection>\n\n- Only emit when the value actually moves (don't spam every reply)\n- 值 is the current cumulative score, not a delta\n- Place at end of reply",
        scope: 'global', scenes: ['chat'], role: 'ai', applyOnDisplay: 1, applyOnPrompt: 0 },
    { name: '網址轉聊天圖片', isHtmlTemplate: true, pattern: '<img\\b[^>]*?\\bsrc=["\']?(https?:\\/\\/[^"\'\\s>]+)["\']?[^>]*>|(?:<(?:img|image|pic|photo|picture|图片|圖片|照片)>|\\[img\\])\\s*(https?:\\/\\/[^\\s<>"\'\\[\\]]+)\\s*(?:<\\/(?:img|image|pic|photo|picture|图片|圖片|照片)>|\\[\\/img\\])|!\\[[^\\]]*\\]\\((https?:\\/\\/[^\\s)]+)\\)|(https?:\\/\\/[^\\s<>"\'\\[\\]()]+?\\.(?:png|jpe?g|gif|webp|avif|bmp)(?:\\?[^\\s<>"\'\\[\\]()]*)?)(?![\\w.\\/-])',
        flags: 'gi', parseMode: 'text',
        htmlTemplate: '<img class="rg-chat-img" src="{{$1}}{{$2}}{{$3}}{{$4}}" alt="">',
        cssScope: '.rg-chat-img{display:block;max-width:100%;max-height:360px;border-radius:10px;margin:4px 0;object-fit:contain}',
        scope: 'global', scenes: ['chat'], role: 'both', applyOnDisplay: 1, applyOnPrompt: 0 },
] as const;
