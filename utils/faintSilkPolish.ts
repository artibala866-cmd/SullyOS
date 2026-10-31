/**
 * Faint Silk (浅丝) mobile-fit repair.
 * Scoped by callers to this outfit only; this CSS deliberately replaces imported
 * sticker icons with functional native Phosphor icons. Older saved whitebox CSS
 * continues to work without re-applying the preset.
 */
export const FAINT_SILK_POLISH_CSS = `
.sully-chat-root {
  --faint-ink:#393633;
  --faint-edge:rgba(104,94,91,.16);
  --faint-glass:rgba(255,255,255,.61);
  --faint-muted:rgba(70,65,61,.56);
}
.sully-chat-root .sully-chat-header {
  background:rgba(248,247,246,.76)!important;
  border:0!important;
  border-bottom:1px solid rgba(92,82,78,.09)!important;
  box-shadow:none!important;
  backdrop-filter:blur(14px)!important;
  -webkit-backdrop-filter:blur(14px)!important;
}
.sully-chat-root .sully-chat-name{font-size:17px!important;font-weight:600!important;letter-spacing:.15px!important;}
.sully-chat-root .sully-chat-status{font-size:10px!important;color:#9b948e!important;letter-spacing:.04em;}
.sully-chat-root .sully-chat-avatar{box-shadow:0 2px 10px rgba(62,55,52,.09)!important;}
/* Do not paint image stickers on top of native navigation, AI or input buttons. */
.sully-chat-root .sully-chat-back,
.sully-chat-root .sully-chat-trigger,
.sully-chat-root .sully-chat-actions-button,
.sully-chat-root .sully-chat-input-wrap button[aria-label="表情面板"]{
  background-image:none!important;
  background-position:initial!important;
}
.sully-chat-root .sully-chat-back,
.sully-chat-root .sully-chat-trigger,
.sully-chat-root .sully-chat-header button[aria-label="电话"],
.sully-chat-root .sully-chat-header button[aria-label="群聊记忆规则"]{
  box-sizing:border-box!important;
  width:38px!important;height:38px!important;
  min-width:38px!important;min-height:38px!important;
  padding:8px!important;
  border-radius:50%!important;
  border:1px solid rgba(118,106,101,.13)!important;
  color:#5d5550!important;
  background:rgba(255,255,255,.52)!important;
  box-shadow:none!important;
  display:inline-flex!important;align-items:center!important;justify-content:center!important;
  backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
}
.sully-chat-root .sully-chat-header button[aria-label="电话"],
.sully-chat-root .sully-chat-header button[aria-label="群聊记忆规则"]{right:46px!important;bottom:8px!important;}
.sully-chat-root .sully-chat-back > svg,
.sully-chat-root .sully-chat-trigger > svg,
.sully-chat-root .sully-chat-actions-button > svg,
.sully-chat-root .sully-chat-input-wrap button[aria-label="表情面板"] > svg{
  display:block!important;
  visibility:visible!important;opacity:1!important;
  width:20px!important;height:20px!important;
  filter:none!important;
}
.sully-chat-root .sully-chat-header button[aria-label="电话"] > svg,
.sully-chat-root .sully-chat-header button[aria-label="群聊记忆规则"] > svg{
  width:20px!important;height:20px!important;
  display:block!important;visibility:visible!important;
}
/* A single compact composer instead of four unrelated oversized icon stickers. */
.sully-chat-root .sully-chat-inputbar{
  background:rgba(248,247,246,.88)!important;
  border:0!important;border-top:1px solid rgba(92,82,78,.11)!important;
  border-radius:0!important;
  box-shadow:none!important;
  backdrop-filter:blur(16px)!important;-webkit-backdrop-filter:blur(16px)!important;
}
.sully-chat-root .sully-chat-composer{
  display:flex!important;align-items:center!important;
  gap:8px!important;
  padding:8px 10px!important;
  min-width:0!important;
}
.sully-chat-root .sully-chat-actions-button{
  box-sizing:border-box!important;
  width:40px!important;height:40px!important;min-width:40px!important;min-height:40px!important;
  padding:9px!important;
  flex-shrink:0!important;
  border:1px solid rgba(118,106,101,.18)!important;
  border-radius:50%!important;
  background:rgba(255,255,255,.62)!important;
  color:#655b54!important;
  box-shadow:none!important;
  display:flex!important;align-items:center!important;justify-content:center!important;
}
.sully-chat-root .sully-chat-input-wrap{
  box-sizing:border-box!important;min-width:0!important;flex:1 1 0%!important;
  min-height:42px!important;
  border:1px solid rgba(118,106,101,.18)!important;
  border-radius:22px!important;
  background:rgba(255,255,255,.73)!important;
  box-shadow:none!important;
  backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
  padding-left:3px!important;padding-right:4px!important;
  display:flex!important;align-items:center!important;
}
.sully-chat-root .sully-chat-input-wrap:focus-within{
  border-color:rgba(118,106,101,.43)!important;
  background:rgba(255,255,255,.94)!important;
}
.sully-chat-root .sully-chat-textarea{
  min-width:0!important;
  padding:9px 8px 8px 12px!important;
  font-size:15px!important;line-height:1.45!important;
  border:0!important;background:transparent!important;
  color:#3b3530!important;
  box-shadow:none!important;
}
.sully-chat-root .sully-chat-textarea::placeholder{color:#aaa39e!important;opacity:1!important;}
.sully-chat-root .sully-chat-input-wrap button[aria-label="表情面板"],
.sully-chat-root .sully-chat-voice-trigger{
  flex-shrink:0!important;
  width:31px!important;height:35px!important;
  min-width:31px!important;
  padding:0!important;
  background:transparent!important;
  border:0!important;border-radius:50%!important;
  color:#89817a!important;box-shadow:none!important;
}
.sully-chat-root .sully-chat-input-wrap button[aria-label="表情面板"] > svg,
.sully-chat-root .sully-chat-voice-trigger > svg{width:19px!important;height:19px!important;}
.sully-chat-root .sully-chat-send-button{
  box-sizing:border-box!important;
  width:40px!important;height:40px!important;
  min-width:40px!important;min-height:40px!important;
  flex:0 0 40px!important;
  display:flex!important;align-items:center!important;justify-content:center!important;
  padding:0!important;
  border:0!important;border-radius:50%!important;
  background:#6a615c!important;color:#fff!important;
  box-shadow:0 2px 8px rgba(70,56,50,.13)!important;
  background-image:none!important;
}
.sully-chat-root .sully-chat-send-button:disabled{
  color:#aaa39e!important;background:#e7e4e1!important;
  box-shadow:none!important;
}
.sully-chat-root .sully-chat-send-button > svg{
  display:block!important;visibility:visible!important;
  width:19px!important;height:19px!important;
  opacity:1!important;
}
/* Softer strokes, a more legible message rhythm, unchanged message semantics. */
.sully-chat-root .sully-bubble-user,
.sully-chat-root .sully-bubble-ai{
  border-color:var(--faint-edge)!important;
  background:var(--faint-glass)!important;
  background-image:none!important;
  color:var(--faint-ink)!important;
  padding:8px 12px!important;
  font-size:14px!important;
  line-height:1.5!important;
  box-shadow:0 1px 2px rgba(70,60,55,.035)!important;
  text-shadow:none!important;
}
.sully-chat-root .sully-bubble-user{border-radius:16px 16px 5px 16px!important;}
.sully-chat-root .sully-bubble-ai{border-radius:16px 16px 16px 5px!important;}
.sully-chat-root .sully-voice-bar,
.sully-chat-root .sully-chat-transfer-card,
.sully-chat-root .sully-chat-transfer-receipt,
.sully-chat-group-root .sully-chat-group-packet,
.sully-chat-group-root .sully-chat-group-packet-receipt{
  background:var(--faint-glass)!important;
  border-color:var(--faint-edge)!important;
  box-shadow:0 1px 2px rgba(70,60,55,.035)!important;
}
/* 320px–380px phones: keep button tap targets and input from collapsing. */
@media(max-width:380px){
 .sully-chat-root .sully-chat-composer{gap:6px!important;padding-left:8px!important;padding-right:8px!important;}
 .sully-chat-root .sully-chat-input-wrap{padding-left:0!important;padding-right:2px!important;}
 .sully-chat-root .sully-chat-back,.sully-chat-root .sully-chat-trigger{width:36px!important;height:36px!important;min-width:36px!important;min-height:36px!important;}
 .sully-chat-root .sully-chat-header button[aria-label="电话"],
 .sully-chat-root .sully-chat-header button[aria-label="群聊记忆规则"]{right:43px!important;}
}
`;
