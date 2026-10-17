/** True for action names (with or without a service prefix) that delete or destroy resources. */
export function isDeletion(actionName: string): boolean {
  const bare = actionName.slice(actionName.indexOf(":") + 1);
  return /delet|purge/i.test(bare) || /^terminate/i.test(bare);
}
