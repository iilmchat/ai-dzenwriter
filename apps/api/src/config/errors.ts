export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

interface IssueLike {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

// Превращает ошибки валидации в строки вида «поле: сообщение».
export function describeIssues(issues: readonly IssueLike[]): string[] {
  return issues.map(
    (issue) => `${issue.path.map(String).join('.') || '(корень)'}: ${issue.message}`,
  );
}
