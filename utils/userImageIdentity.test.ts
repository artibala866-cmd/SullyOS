import { describe, expect, it } from 'vitest';
import { describesUserInPhoto } from './userImageIdentity';

describe('Echoes-inspired user face reference subject selection', () => {
  it('uses user identity for selfies or images clearly depicting the sender', () => {
    for (const prompt of [
      '我站在雨夜街头，手拿透明雨伞',
      '对镜自拍，穿红色连衣裙',
      '一张我和朋友在海边的合照',
      '照片里的我穿着白色婚纱',
      'selfie on a city street',
      'a portrait of me, sunlight',
    ]) expect(describesUserInPhoto(prompt)).toBe(true);
  });

  it('does not lock the user face onto food, pets, landscape or a different person', () => {
    for (const prompt of [
      '一盘精致的甜点',
      '雨夜里的城市霓虹',
      '我拍的风景照，一座雪山',
      '我家猫在沙发上睡觉',
      '一张朋友的自拍照',
      'beautiful flowers and a glass of coffee',
    ]) expect(describesUserInPhoto(prompt)).toBe(false);
  });
});
