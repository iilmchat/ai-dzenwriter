import type { VersionCheck, VersionClaim } from '@dzenwriter/shared';
import { buildContext, locateClaims, type CheckInput } from './check-context';
import { runCommonChecks } from './common-rules';
import { runStyleChecks } from './style-rules';

export interface CheckOutput {
  readonly checks: readonly VersionCheck[];
  // Утверждения с местом в тексте: редактор подсвечивает их.
  readonly claims: readonly VersionClaim[];
}

// Движок проверок: считает все проверки для версии статьи.
// Вызывается при каждой генерации и каждом сохранении версии.
export function runChecks(input: CheckInput): CheckOutput {
  const context = buildContext(input);
  const checks = [...runStyleChecks(context), ...runCommonChecks(context)];
  return {
    checks: sortChecks(checks),
    claims: locateClaims(input.claims, input.articleMarkdown),
  };
}

// Сначала блокирующие, потом предупреждения и информационные: так автор
// видит главное первым.
function sortChecks(checks: readonly VersionCheck[]): VersionCheck[] {
  const order: Record<VersionCheck['severity'], number> = { block: 0, warn: 1, info: 2 };
  return [...checks].sort((left, right) => {
    const bySeverity = order[left.severity] - order[right.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    return (left.start ?? 0) - (right.start ?? 0);
  });
}
