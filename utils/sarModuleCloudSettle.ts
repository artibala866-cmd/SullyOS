/**
 * Compatibility shim for older ActiveMsg 2.0 push payloads.
 *
 * 彼方 / SAR is retired. This file ONLY removes obsolete transport metadata from old push
 * messages. It must never parse/activate old modules, alter dialog, or write to IndexedDB.
 * Kept temporarily while ActiveMsg 2.0 callers migrate off the old metadata fields.
 */
export const AMSG_SAR_TRANSPORT_KEYS = [
  'amsgSar', 'amsgSarRef', 'amsgSarSurface', 'amsgSarSurfaceRef',
  'amsgSarUserSurface', 'amsgSarUserSurfaceRef',
] as const;

export const stripAmsgSarTransportKeys = <T extends Record<string, any>>(
  metadata: T | null | undefined,
): T => {
  const next = { ...(metadata || {}) } as Record<string, any>;
  for (const key of AMSG_SAR_TRANSPORT_KEYS) delete next[key];
  return next as T;
};

// Strictly inert compatibility signatures: old or delayed cloud replies cannot restore
// the retired feature. Preserve normal message delivery if an old Worker sends those keys.
type LegacySnapshot = Record<string, any>;
type LegacySurface = Record<string, any>;
export type SarOffloadedFetcher = () => Promise<string | null>;

export const readAmsgSarSurface = (_metadata: Record<string, any> | null | undefined): LegacySurface | undefined => undefined;
export const parseAmsgSarSurface = (_raw: unknown): LegacySurface | undefined => undefined;
export const readAmsgSarSnapshot = (_metadata: Record<string, any> | null | undefined): LegacySnapshot | undefined => undefined;
export const parseAmsgSarSnapshot = (_raw: unknown): LegacySnapshot | undefined => undefined;
export const resolveAmsgSarSurface = async (
  _metadata: Record<string, any> | null | undefined,
  _fetchOffloaded: SarOffloadedFetcher,
): Promise<LegacySurface | undefined> => undefined;
export const resolveAmsgSarSnapshot = async (
  _metadata: Record<string, any> | null | undefined,
  _fetchOffloaded: SarOffloadedFetcher,
): Promise<LegacySnapshot | undefined> => undefined;

export interface SarCloudSettleInput {
  charId: string;
  snapshot: LegacySnapshot;
  userSurfaceRaw?: string | null;
}
export interface SarCloudSettleResult {
  userSurfaceIds: number[];
  eventsWritten: boolean;
  advanced: { character: boolean; user: boolean };
  messagesTouched: boolean;
}
export const settleSarModuleAfterCloudReply = async (_input: SarCloudSettleInput): Promise<SarCloudSettleResult> => ({
  userSurfaceIds: [],
  eventsWritten: false,
  advanced: { character: false, user: false },
  messagesTouched: false,
});
