import { describe, expect, it, vi } from 'vitest';
import { buildFcmMessage, createHybridPushTransport, fcmTokenFromEndpoint } from './nativeFcm';

describe('AMSG2 native FCM transport', () => {
  it('普通 Web Push endpoint 原样委托旧发送器', async () => {
    const sendNotification = vi.fn().mockResolvedValue('web-ok');
    const transport = createHybridPushTransport({}, { sendNotification });
    const subscription = { endpoint: 'https://push.example/sub', keys: { p256dh: 'a', auth: 'b' } };
    await expect(transport.sendNotification(subscription, '{"message":"hi"}')).resolves.toBe('web-ok');
    expect(sendNotification).toHaveBeenCalledWith(subscription, '{"message":"hi"}');
  });

  it('只有 fcm: endpoint 才识别为原生 token', () => {
    expect(fcmTokenFromEndpoint('fcm:abc:123')).toBe('abc:123');
    expect(fcmTokenFromEndpoint('https://push.example/sub')).toBeNull();
    expect(fcmTokenFromEndpoint('fcm:   ')).toBeNull();
  });

  it('通知横幅是摘要时，不许把摘要冒充完整聊天回复', () => {
    const result = buildFcmMessage('token', JSON.stringify({
      messageId: 'm-preview', message: '这是一条很长的真实完整角色回复。',
      contactName: 'Sully', metadata: { charId: 'char-1' },
      notification: { body: 'Sully 发来一条新消息' },
    }));
    expect(result.message.notification.body).toBe('Sully 发来一条新消息');
    expect(result.message.data.amsgHasBody).toBe('0');
    expect(JSON.parse(result.message.data.amsgPayload).message).toBeUndefined();
  });

  it('仅空白正文和默认横幅不能被识别为聊天原文', () => {
    const result = buildFcmMessage('token', JSON.stringify({
      messageId: 'm-blank', message: '   ', metadata: { charId: 'char-1' },
    }));
    expect(result.message.notification.body).toBe('有一条新消息');
    expect(result.message.data.amsgHasBody).toBe('0');
  });

  it('正文只放 notification 一份，data 保留 AMSG2 路由字段', () => {
    const request = buildFcmMessage('token', JSON.stringify({
      messageId: 'm1', message: '你好', contactName: 'Sully',
      metadata: { charId: 'char-1', activeMsg2: true },
    }));
    expect(request.message.notification).toEqual({ title: 'Sully', body: '你好' });
    expect(request.message.data.amsgHasBody).toBe('1');
    const portable = JSON.parse(request.message.data.amsgPayload);
    expect(portable.message).toBeUndefined();
    expect(portable.metadata.charId).toBe('char-1');
  });
});

