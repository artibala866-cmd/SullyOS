import React, {useEffect, useState} from 'react';
import {IMAGE_PERMISSION_CHANGED, imagePermission, setImagePermission, type ImageScope} from '../../utils/automaticImage';

export default function AutomaticImageToggle({scope, id}: {scope: ImageScope; id: string}) {
    const [enabled, setEnabled] = useState(() => !!imagePermission(scope, id));
    const [error, setError] = useState(false);
    useEffect(() => {
        const sync = () => setEnabled(!!imagePermission(scope, id));
        sync();
        window.addEventListener(IMAGE_PERMISSION_CHANGED, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(IMAGE_PERMISSION_CHANGED, sync);
            window.removeEventListener('storage', sync);
        };
    }, [scope, id]);
    return <div className="py-2">
        <label className="flex items-center justify-between gap-3 text-sm">
            <span>{scope === 'moments' ? '朋友圈生图' : '角色主动生图'}</span>
            <input type="checkbox" role="switch" checked={enabled} onChange={event => {
                try { setImagePermission(scope, id, event.target.checked); setError(false); }
                catch { setError(true); }
            }} />
        </label>
        <p className="mt-1 text-xs text-neutral-500">{scope === 'moments' ? '开启后，适合配图的动态可调用生图 API。' : '开启后，角色才有机会随回复发图。'}</p>
        {error && <p role="alert" className="text-xs text-red-700">生图开关保存失败</p>}
    </div>;
}
