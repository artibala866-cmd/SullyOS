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
        throw new Error('剧情生成被上游拦截，未保存不完整正文。原推进仍在，请调整内容后重试');
    }
    // Only enforce the terminal chunk for a stream we KNOW was assembled by
    // our interceptor. Some compatible non-stream endpoints omit finish_reason
    // on otherwise valid replies, and must not be rejected for that alone.
    if (response.headers.get('X-Sully-Upgraded-Stream') === '1' && !reason) {
        throw new Error('剧情生成连接提前中断，未收到完整结束信号；半截正文不会被保存。原推进已保留，可重新尝试');
    }
}
