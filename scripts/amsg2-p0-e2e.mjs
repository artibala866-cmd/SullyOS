/** P0 acceptance: production Cloudflare bundle in Node 22 with real SQLite D1
 * contracts, Cron, rei-client encryption, RFC8291 Web Push and scripted LLM.
 * The only stubs are network targets, Cloudflare DurableObject superclass,
 * and an in-memory D1; real Cloudflare account/device cannot be asserted here.
 */
/**
 * amsg2 本地全流程实测 harness（上线前检查用，跑法：`node scripts/amsg2-e2e-harness.mjs`）。
 *
 * 需 amsg-server ≥2.6.0-next.10 的 bundle 才能跑：断言依赖发送后回执 onAfterSend
 * （self_log 的实际发送时刻）与 tzId 时间渲染，旧 bundle 会在这些断言上挂。
 *
 * 跑的是仓库里提交的 **同一份** worker/amsg/worker.bundle.js（用户粘进 CF Dashboard 的就是它），
 * 外围环境全部真实化：
 *   - D1 → node:sqlite 内存库（prepare/bind/run/first/all/batch 语义对齐；需要 Node 22+）
 *   - Web Push → 真实 VAPID + RFC8291 aes128gcm 加密，harness 持有浏览器侧私钥现场解密验内容
 *   - LLM → mock（按请求内容路由脚本回复，校验请求里的 prompt 是不是 fire-time 现场渲染）
 *   - HTTP → node:http 桥接 worker.fetch，前端同款 @rei-standard/amsg-client 直连
 *
 * 场景：
 *   S0 鉴权/CORS/capabilities   S1 init-tenant + get-user-key + vapid-public-key
 *   S2 fixed 一次性任务端到端    S3 满血 v2 多任务（fire_pack 现场填槽 + RECALL 工具循环 +
 *      directives + occurrenceMs + 大值分块 + daily 推进 + /messages 投影 + cancel）
 *   S4 防穿帮闸：锚点前进 → skip  S5a 活跃租约新鲜 → skip（无 fire_pack 也拦）
 *   S5b 租约过期 + 无 fire_pack → 抛错不降级        S6 force 策略 → 全绿灯照发
 *   S7 clear-client-state
 *   S8 通用 MCP native（tools 声明 → 直连真 MCP 服务器 → 结果回喂 → 暗号进 push）
 *   S8b 通用 MCP 正文兜底（不带 tools，提示词教协议，正文里的调用被识别执行）
 *   S9 自排链（角色到点给自己排下一条 → 用户全程不上线 → 下一条读得到上一条说了什么）
 *
 * 有意不进 vitest：它要起真端口、真等 cron 到点（多处 1.4s sleep）、并 mock 全局 fetch，
 * 是发布前手动跑的端到端体检，不是单测。改 worker/amsg 或升 amsg-server 后跑一次。
 */
// The real Cloudflare bundle imports DurableObject from cloudflare:workers.
// Node's test runner does not implement Cloudflare's ESM URL scheme. Stub
// ONLY the Cloudflare superclass for this in-memory D1/Cron/WebPush harness;
// all Worker endpoints/hooks are still the freshly bundled production code.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        url: 'data:text/javascript,' + encodeURIComponent(
          'export class DurableObject { constructor(state, env) { this.ctx = state; this.env = env; } }'
        ),
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(`${REPO}/package.json`);
const webpush = require('web-push');
const { ReiClient } = await import(pathToFileURL(`${REPO}/node_modules/@rei-standard/amsg-client/dist/index.mjs`));
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// ─── 断言与结果账本 ───
const results = [];
let failures = 0;
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond, detail });
  if (!cond) failures++;
  console.log(`${cond ? '  ✅' : '  ❌'} ${name}${cond ? '' : detail ? `  ← ${detail}` : ''}`);
};
const section = (t) => console.log(`\n━━ ${t}`);

// ─── D1 shim（node:sqlite） ───
class D1Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...p) { this.params = p.map((v) => v === undefined ? null : v); return this; }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) }, results: [] };
  }
  async first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
}
class D1Shim {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new D1Stmt(this.db, sql); }
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
  raw(sql) { return this.db.prepare(sql).all(); }
}

// ─── 环境（与 CF Dashboard 部署一致的 env） ───
const vapidKeys = webpush.generateVAPIDKeys();
const SERVER_TOKEN = 'launch-check-shared-secret';
const d1 = new D1Shim();
const env = {
  AMSG_MASTER_KEY: crypto.randomBytes(32).toString('hex'),
  VAPID_EMAIL: 'mailto:e2e@example.com',
  VAPID_PUBLIC_KEY: vapidKeys.publicKey,
  VAPID_PRIVATE_KEY: vapidKeys.privateKey,
  AMSG_SERVER_TOKEN: SERVER_TOKEN,
  DB: d1,
};

// ─── 浏览器侧 push 订阅密钥（真实 P-256 + auth secret），并实现 RFC8291 解密 ───
const receiver = crypto.createECDH('prime256v1');
receiver.generateKeys();
const authSecret = crypto.randomBytes(16);
const subscriptionFor = (tag) => ({
  endpoint: `https://push.test/${tag}`,
  keys: { p256dh: b64u(receiver.getPublicKey()), auth: b64u(authSecret) },
});
const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
function decryptPush(bodyBuf) {
  const salt = bodyBuf.subarray(0, 16);
  const idlen = bodyBuf[20];
  const senderPub = bodyBuf.subarray(21, 21 + idlen);
  const ct = bodyBuf.subarray(21 + idlen);
  const shared = receiver.computeSecret(senderPub);
  const prkInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), senderPub]);
  const ikm = hkdf(authSecret, shared, prkInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const dec = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  dec.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([dec.update(ct.subarray(0, ct.length - 16)), dec.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  if (plain[end] !== 0x02) throw new Error('bad aes128gcm padding delimiter');
  return JSON.parse(plain.subarray(0, end).toString('utf8'));
}

// ─── 出网 fetch 拦截：push 端点 + mock LLM，其余透传（本地 http 走 127.0.0.1 不受影响） ───
const realFetch = globalThis.fetch;
const pushes = [];            // { tag, headers, payload }
const llmRequests = [];       // 原始请求体

// mock LLM 的两个应答构造器：一次普通回复 / 一次「顺手给自己排下一条」的工具调用。
const llmReply = (content, toolCalls) => new Response(JSON.stringify({
  choices: [{ message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) } }],
}), { status: 200, headers: { 'content-type': 'application/json' } });
const scheduleCall = (id, sendAt, promptHint) => ({
  id, type: 'function',
  function: {
    name: 'schedule_active_message',
    arguments: JSON.stringify({
      send_at: sendAt,
      ...(promptHint ? { mode: 'prompted', prompt_hint: promptHint } : {}),
    }),
  },
});
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://push.test/')) {
    const tag = url.slice('https://push.test/'.length);
    const headers = init.headers || {};
    const payload = decryptPush(Buffer.from(init.body));
    pushes.push({ tag, headers, payload });
    return new Response(null, { status: 201 });
  }
  if (url.startsWith('https://llm.test/')) {
    const req = JSON.parse(init.body);
    llmRequests.push(req);
    const all = req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    const hasToolResult = req.messages.some((m) => m.role === 'tool');
    let content;
    if (all.includes('FIREPACK_FRESH_char-full') && !hasToolResult) {
      content = '（先想想上个月的事）等我翻翻记忆。\n[[RECALL: 2026-06]]';
    } else if (all.includes('FIREPACK_FRESH_char-full') && hasToolResult) {
      content = '想起来了，六月那天的烟花真好看。\n今晚也想拉你去河边。\n[[ACTION:POKE]]';
    } else if (all.includes('FIREPACK_FRESH_char-mcp-native') && !hasToolResult) {
      // native 模式第 1 轮：正文写旁白 + 走 function calling 通道发起 MCP 调用。
      // 这条要连 tool_calls 一起给，所以不套用下面统一的「只有 content」的包装。
      return new Response(JSON.stringify({ choices: [{ message: {
        role: 'assistant', content: '我问问那边今天的暗号。',
        tool_calls: [{
          id: 'call_mcp_1', type: 'function',
          function: { name: 'mcp__get_secret_word', arguments: '{"asked_by":"小满"}' },
        }],
      } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    } else if (all.includes('FIREPACK_FRESH_char-mcp-native') && hasToolResult) {
      const toolText = req.messages.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n');
      const m = toolText.match(/HARNESS-MCP-\w+/);
      content = `拿到了，今天的暗号是 ${m ? m[0] : '（工具结果里没找到）'}。`;
    } else if (all.includes('FIREPACK_FRESH_char-mcp-text') && !hasToolResult) {
      // 正文兜底模式第 1 轮：模型把调用「演」在正文里（不支持 FC 的中转常见形态）
      content = '我问问那边今天的暗号。\nget_secret_word({"asked_by":"小满"})';
    } else if (all.includes('FIREPACK_FRESH_char-mcp-text') && hasToolResult) {
      const toolText = req.messages.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n');
      const m = toolText.match(/HARNESS-MCP-\w+/);
      content = `拿到了，暗号是 ${m ? m[0] : '（没找到）'}。`;
    } else if (all.includes('FROZEN_char-frozen')) {
      content = '冻结提示词兜底照发成功。';
    } else if (all.includes('FIREPACK_FRESH_char-force')) {
      content = '闹钟型强制发送，正在聊天也照发。';
    } else if (all.includes('FIREPACK_FRESH_char-chain')) {
      // 自排链：角色在这条消息里给自己排下一条，走 function calling 通道。
      // 分支只看「prompt 和回喂里出现了什么」，不数轮次——链断在任何一环，走到的
      // 分支就会不一样，断言直接红，比事后比对正文更贴近「角色到底看见了没有」。
      // 判定顺序要紧：ok:true 排在被打回那条前面，否则第三轮还会看到第一轮的打回记录。
      const seenPass = all.match(/CHAIN-PASS-\d+/);
      if (seenPass) {
        // 第二次触发。口令只可能来自云端自述回写（上一条正文），prompt 里读不到就接不上。
        content = `接着刚才那条说，口令还是 ${seenPass[0]}，我没忘。`;
      } else if (all.includes('"ok":true')) {
        content = '口令给你留一个：CHAIN-PASS-8823，等下我再来对。';
      } else if (all.includes('send_at_too_soon')) {
        // 被打回后按回喂里的话改口，换一个合法时间（5 分钟后）重排。
        return llmReply('那就往后挪挪。', [
          scheduleCall('call_sched_2', new Date(Date.now() + 5 * 60_000).toISOString(), '接着口令那件事往下说'),
        ]);
      } else {
        // 第一轮故意把时间写太近（30 秒后）：验「参数写歪只回喂让它改口，不让整条 fire 失败」。
        return llmReply('等我先把后面那条排上。', [scheduleCall('call_sched_1', new Date(Date.now() + 30_000).toISOString())]);
      }
    } else {
      content = '（默认回复：未匹配任何脚本分支）';
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  return realFetch(input, init);
};

// ─── 载入与线上部署同一份的 worker bundle，并起 http 桥 ───
const worker = (await import(pathToFileURL(`${REPO}/worker/amsg/worker.bundle.js`))).default;
const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) || body.length === 0 ? undefined : body,
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500); res.end(String(e && e.stack || e));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const runCron = () => worker.scheduled({ scheduledTime: Date.now(), cron: '* * * * *' }, env);
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const USER_ID=crypto.randomUUID();
const client=new ReiClient({baseUrl:BASE,userId:USER_ID,serverToken:SERVER_TOKEN});
const headers=(extra={})=>({'X-Client-Token':SERVER_TOKEN,'X-User-Id':USER_ID,...extra});
async function schedule(payload){
  const encrypted=await client._encrypt(JSON.stringify(payload));
  const res=await realFetch(BASE+'/schedule-message',{
    method:'POST',headers:headers({'Content-Type':'application/json','X-Payload-Encrypted':'true','X-Encryption-Version':'1'}),
    body:JSON.stringify(encrypted)
  });
  return res.json();
}
async function list(){
  const res=await realFetch(BASE+'/messages?limit=100&offset=0',{headers:headers({'X-Response-Encrypted':'true','X-Encryption-Version':'1'})});
  const json=await res.json();
  if(!json.success)throw Error('GET /messages: '+JSON.stringify(json.error));
  return json.encrypted ? client._decrypt(json.data) : json.data;
}
const nowIso=()=>new Date(Date.now()+1100).toISOString();
const ID=()=>crypto.randomUUID();
const common=(charId,charName,mode,when,recurrenceType='none')=>({
  contactName:charName, messageType:mode,messageSubtype:'chat',
  firstSendTime:when,recurrenceType,
  metadata:{charId,charName,source:'active_msg_2',amsgMode:mode,
    amsgClientTaskId:ID(),amsgExpirePolicy:'expire',amsgRecurrence:recurrenceType,
    amsgAnchorMs:Date.now()-3600000},
});
const tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'Etc/UTC';
const fire=(marker,last,scene=null)=>({
  v:7,template:[
    '【角色系统设定】你是一个自然说话的朋友。 '+marker,
    '【最近对话上下文】','user: 最近有什么趣事？',
    '{{AMSG_SELF_LOG}}','当前时间 {{AMSG_CURRENT_TIME}}',
    '{{AMSG_TIME_SINCE_USER}}','{{AMSG_AWAY_HINT}}',
    '{{AMSG_TASK_LIST}}','【本次任务】','{{AMSG_TASK_INSTRUCTION}}'
  ].join('\n'),
  lastUserMessageAt:last,tzId:tz,userTzId:tz,targetName:'测试用户',
  builtAt:Date.now(),pendingTasks:[],scene,selfScheduleEnabled:true
});
const tool={v:1,charName:'小满',xhsEnabled:false,timeAwarenessEnabled:true,
  activeMemoryMonths:[],memories:[{date:'2026-06-15',summary:'RECALL_MEMORY_MARKER 一起看烟花',mood:'开心'}]};
const globalTool={v:1,proxyWorkerUrl:'',newsEnabled:false,notionEnabled:false,feishuEnabled:false};
async function putRole(charId,marker,last,scene=null){
  await client.putClientState([
    {namespace:'amsg:char:'+charId,key:'fire_pack',value:JSON.stringify(fire(marker,last,scene)),updatedAt:Date.now()},
    {namespace:'amsg:char:'+charId,key:'tool_pack',value:JSON.stringify(tool),updatedAt:Date.now()},
    {namespace:'amsg:global',key:'tool_config',value:JSON.stringify(globalTool),updatedAt:Date.now()},
  ]);
}
const auto=(charId,when,recurrence='none',extra={})=>({
  ...common(charId,'小满','auto',when,recurrence),
  messages:[{role:'user',content:'AMSG2 scheduled placeholder'}],
  apiUrl:'https://llm.test/v1/chat/completions',apiKey:'sk-e2e',
  primaryModel:'mock-model',...extra
});
async function subscribe(label){
  const r=await client.putPushSubscription(subscriptionFor(label));
  check('用户级 Web Push 订阅登记（'+label+'）',r?.success===true,JSON.stringify(r));
}
try{
  const init=await(await realFetch(BASE+'/init-tenant',{method:'POST',headers:headers()})).json();
  check('D1 数据库初始化成功',init?.success===true,JSON.stringify(init));
  await client.init();
  const vapid=await client.getVapidPublicKey();
  check('真实 VAPID 公钥握手',vapid===vapidKeys.publicKey);
  const caps=await client.getCapabilities();
  check('运行的确实是最新版 Worker 加密/任务协议',!!caps?.features?.includes('agentic-hooks'),JSON.stringify(caps));

  await subscribe('fixed');
  const fixed=common('char-fixed','固定提醒','fixed',nowIso());
  fixed.userMessage='这是云端真正推送的固定内容';
  const scheduled=await schedule(fixed);
  check('固定内容：远端 D1 创建成功',scheduled?.success===true,JSON.stringify(scheduled));
  await sleep(1450);
  await runCron();
  const fixedPush=pushes.filter(p=>p.tag==='fixed');
  check('固定内容：Cron 到点发出真实加密 Push',fixedPush.length===1&&fixedPush[0]?.payload?.message===fixed.userMessage,JSON.stringify(fixedPush.map(x=>x.payload?.message)));
  check('固定内容：带有 VAPID 签名',!!(fixedPush[0]?.headers?.Authorization||fixedPush[0]?.headers?.authorization));
  const afterFixed=await list();
  check('固定内容：一次性任务成功后已从云端删除',
    !afterFixed.tasks.some(x=>x.uuid===scheduled?.data?.uuid));

  await subscribe('autonomous');
  const old=Date.now()-3600000;
  await putRole('char-full','FIREPACK_FRESH_char-full',old);
  const planned=auto('char-full',nowIso(),'daily');
  planned.metadata.amsgTaskInstruction='这是自主联系机会；根据实际聊天决定要不要开口。';
  const task=await schedule(planned);
  check('自动联系：持续每日任务确实进 D1',task?.success===true,JSON.stringify(task));
  const before=llmRequests.length;
  await sleep(1450);
  await runCron();
  const reqs=llmRequests.slice(before);
  check('自动联系：Worker 按到点上下文真的调用 LLM',reqs.length>=1,JSON.stringify(reqs.map(x=>x.model)));
  check('自动联系：到点动态读取角色最新同步的私聊上下文',
    reqs.some(x=>JSON.stringify(x.messages).includes('FIREPACK_FRESH_char-full')));
  const autoPush=pushes.filter(p=>p.tag==='autonomous');
  check('自动联系：至少一段消息经真实 VAPID 加密送达',autoPush.length>=1,JSON.stringify(autoPush.map(x=>x.payload?.message)));
  const afterAuto=await list();
  const recurring=afterAuto.tasks.find(x=>x.uuid===task?.data?.uuid);
  check('自动联系：每天的云端任务仍存在并顺延到下一日',
    !!recurring&&new Date(recurring.nextSendAt).getTime()>Date.now()+20*3600000,
    JSON.stringify(recurring));

  await subscribe('quiet');
  const time=Date.now();
  // A scheduled auto contact opportunity is NOT a promise to ping the user.
  // The user's fresh chat presence must defer it without another paid AI call.
  await putRole('char-quiet','FIREPACK_FRESH_char-quiet',time-1000);
  await client.putClientState([{
    namespace:'amsg:char:char-quiet',key:'chat_presence',
    value:JSON.stringify({v:1,charId:'char-quiet',activeAt:Date.now()-1000,lastUserMessageAt:time-1000}),
    updatedAt:Date.now(),
  }]);
  const quiet=auto('char-quiet',nowIso(),'none');
  quiet.metadata.amsgAutonomyWake=true;
  quiet.metadata.amsgTaskInstruction='自主联系的机会，可以选择沉默';
  const q=await schedule(quiet);
  check('正在聊天时：自主联系机会排程成功',q?.success===true,JSON.stringify(q));
  const beforeQuiet=llmRequests.length;
  await sleep(1450);
  await runCron();
  check('正在聊天时：无需付费 LLM 请求，也不会发多余 Push',
    llmRequests.length===beforeQuiet&&pushes.filter(p=>p.tag==='quiet').length===0);

}catch(e){failures++;console.error('P0 端到端执行异常：',e?.stack||e)}
finally{server.close()}
console.log('\nP0 Worker E2E: '+results.filter(x=>x.ok).length+'/'+results.length+' passed, '+failures+' failed');
process.exit(failures?1:0);
