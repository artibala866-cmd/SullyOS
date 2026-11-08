/**
 * Story prose must not silently commit a partial response. In particular the
 * global transparent SSE upgrade can reconstruct valid JSON from a network
 * stream even when its final finish_reason was never received.
 */
export function assertCompleteStoryResponse(response: Response, data: any): void {
    const reason = String(data?.choices?.[0]?.finish_reason || '').trim().toLowerCase();
    if (reason === 'length' || reason === 'max_tokens') {
        throw new Error('剧情生成已达到输出上限，未保存半截正文。原推进仍在，请提高最大输出或减少思考量后重试');
    }
    if (reason === 'content_filter') {
        // HTTP 200 and billed output tokens do NOT mean the provider delivered
        // usable story text. Do not resubmit or save filtered/partial results.
        throw new Error('上游返回 content_filter（内容过滤拦截）：可能已经扣费，但没有可保存的完整剧情。原推进已保留；请先核对站子该笔响应，不要连续重试');
    }
    // A stream:false request can receive SSE anyway. safeResponseJson marks
    // its terminal evidence separately, because only the global-upgrade path
    // sets the X-Sully headers. Otherwise a cut-off raw SSE could be saved.
    const upgradedIncomplete = response.headers.get('X-Sully-Upgraded-Stream') === '1'
        && response.headers.get('X-Sully-Stream-Terminal') !== '1';
    const rawSseIncomplete = data?.__sullyRawStreamTerminal === false;
    if ((upgradedIncomplete || rawSseIncomplete) && !reason) {
        throw new Error('剧情生成连接提前中断，未收到完整结束信号；半截正文不会被保存。原推进已保留，请检查站子后再重试');
    }
}
