import { existsSync } from 'node:fs';
import path from 'node:path';

// Локальный .env из корня репозитория. В CI переменные задаются окружением.
const envFile = path.resolve(process.cwd(), '../../.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
