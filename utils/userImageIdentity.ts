/**
 * Echoes-style subject detection for user-origin photos: a reference image
 * should represent the sender only if the sender appears in the scene.
 * A photo of scenery, an object, or a third party must never silently become
 * a portrait of the user. The composer always permits an explicit override.
 */
export function describesUserInPhoto(text: string): boolean {
  const prompt = text.trim();
  if (!prompt) return false;
  return /自拍|自拍照|自拍像|对镜自拍|镜中自拍|镜前自拍|合照|同框|咱俩|本人出镜|拍我|照我|我的脸|我的自拍|我和|我跟|我与|我们一起|我穿|我身穿|我站|我坐|我躺|我蹲|我走|我跑|我靠|我抱|我拿|我举|我在|我正|我笑|我回头|我看着|我出镜|我入镜|我戴|我身旁|我身后|我旁边|我被拍|我的照片|照片里的我|把我|给我换|给我穿|将我|selfie|portrait\s+of\s+me|photo\s+of\s+me|picture\s+of\s+me|my\s+face|me\s+wearing|picture\s+of\s+us|photo\s+of\s+us/i.test(prompt);
}
