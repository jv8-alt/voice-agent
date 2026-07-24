import type {
  ActionRiskAssessment,
  ActionRiskEvaluator,
  EvaluateActionsInput,
  ProposedAction,
} from '@voice-agent/contracts';

const DESTRUCTIVE_COMMANDS = [
  /\brm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b/i,
  /\bgit\s+(?:reset\s+--hard|clean\s+-[^\s]*f|push\b[^\n]*--force|branch\s+-D)\b/i,
  /\b(?:drop|truncate)\s+(?:database|schema|table)\b/i,
  /\b(?:mkfs|diskutil\s+erase|shutdown|reboot)\b/i,
  /\b(?:sudo|chmod\s+-R|chown\s+-R)\b/i,
];
const CREDENTIAL_PATH = /(?:^|[/\\])(?:\.env(?:\.|$)|\.ssh|\.aws|\.config[/\\]gcloud|credentials?|secrets?)(?:[/\\]|$)/i;
const SYSTEM_PATH = /^(?:\/(?:etc|usr|bin|sbin|var|System|Library)|[A-Za-z]:\\Windows)(?:[/\\]|$)/i;
const CREDENTIAL_COMMAND = /(?:^|[/\\\s"'=])(?:\.env(?:\.[^\s"'`]+)?|\.ssh|\.aws|\.config[/\\]gcloud|credentials?|secrets?)(?:[/\\\s"'`]|$)/i;
const SYSTEM_COMMAND = /(?:^|[\s"'=])(?:\/(?:etc|usr|bin|sbin|var|System|Library)|[A-Za-z]:\\Windows)(?:[/\\\s"'`]|$)/i;
const DEPENDENCY_COMMAND = /\b(?:npm|pnpm|yarn)\s+(?:add|install|remove|update|upgrade)\b/i;
const BROAD_DELETE = /\b(?:rm|del|rmdir)\b/i;

function riskReason(action: ProposedAction): string | null {
  if (action.kind === 'network') return 'The plan requests external network access.';
  if (action.paths?.some((path) => CREDENTIAL_PATH.test(path))) return 'The plan may access credentials or secrets.';
  if (action.paths?.some((path) => SYSTEM_PATH.test(path))) return 'The plan may change files outside the workspace.';

  const command = action.command ?? '';
  if (CREDENTIAL_COMMAND.test(command)) return 'The plan may access credentials or secrets.';
  if (SYSTEM_COMMAND.test(command)) return 'The plan may change files outside the workspace.';
  if (DESTRUCTIVE_COMMANDS.some((pattern) => pattern.test(command))) return 'The plan includes a destructive system or repository command.';
  if (DEPENDENCY_COMMAND.test(command)) return 'The plan changes project dependencies.';
  if (BROAD_DELETE.test(command)) return 'The plan may delete files.';
  return null;
}

/** Deterministic, fail-closed policy for proposed coding-agent actions. */
export class HeuristicActionRiskEvaluator implements ActionRiskEvaluator {
  async evaluate(input: EvaluateActionsInput): Promise<ActionRiskAssessment> {
    const reasons = [...new Set(input.actions.map(riskReason).filter((reason): reason is string => reason !== null))];
    return reasons.length === 0 ? { level: 'safe', reasons: [] } : { level: 'sensitive', reasons };
  }
}
