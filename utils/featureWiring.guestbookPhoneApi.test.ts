import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('旧查手机配置的备份兼容', () => {
    it('独立 API 会进入完整/纯文本备份并在导入时恢复', () => {
        const context = read('context/OSContext.tsx');
        const types = read('types.ts');
        expect(types).toContain('checkPhoneApi?: APIConfig | null');
        expect(context).toContain('checkPhoneApi: (mode === \'text_only\' || mode === \'full\') ? getCheckPhoneApi() : undefined');
        expect(context).toContain('if (data.checkPhoneApi !== undefined) setCheckPhoneApi(data.checkPhoneApi ?? null)');
    });
});
