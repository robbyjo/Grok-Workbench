export const permissionModes = ['ask', 'auto', 'always-approve'] as const;
export type PermissionMode = (typeof permissionModes)[number];

export function validatePermissionMode(value: unknown): PermissionMode {
  if (typeof value !== 'string' || !permissionModes.includes(value as PermissionMode))
    throw new Error('Invalid permission mode.');
  return value as PermissionMode;
}

// Keep existing per-chat choices from profiles written before the three-mode selector.
export function savedPermissionMode(thread: {
  permissionMode?: PermissionMode;
  alwaysApprove?: boolean;
}): PermissionMode | undefined {
  return (
    thread.permissionMode ??
    (thread.alwaysApprove === undefined
      ? undefined
      : thread.alwaysApprove
        ? 'always-approve'
        : 'ask')
  );
}

export const permissionModeDescriptions: Record<PermissionMode, string> = {
  ask: 'Ask when a tool needs permission. Existing allow rules still apply.',
  auto: 'Grok reviews tool calls and approves those it considers safe. Risky actions may still ask. Requires engine Auto mode to be enabled.',
  'always-approve':
    'Approve tool calls without individual prompts. Project trust, deny rules, hooks and managed restrictions still apply.',
};
