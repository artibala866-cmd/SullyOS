export const isAutonomyWakeTask = (task: { clientTaskId?: string | null }) =>
  typeof task?.clientTaskId === 'string' && task.clientTaskId.startsWith('autowake:');

export function isRetiredAutonomyDelivery(metadata?: Record<string, unknown> | null): boolean {
  return metadata?.amsgAutonomyWake === true ||
    (typeof metadata?.amsgClientTaskId === 'string' && isAutonomyWakeTask({ clientTaskId: metadata.amsgClientTaskId }));
}
