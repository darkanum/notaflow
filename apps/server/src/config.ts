export type AuthConfig =
  { mode: 'access'; teamDomain: string; audience: string } | { mode: 'dev'; email: string };

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databasePath: string;
  appOrigin: string;
  masterKey: Buffer;
  auth: AuthConfig;
  nacionalUrls?: { sefin: string; adn: string };
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];
  const required = (name: string): string => {
    const value = env[name];
    if (!value) problems.push(`${name} is required`);
    return value ?? '';
  };

  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    problems.push('NODE_ENV must be development, test, or production');
  }
  const databasePath = required('DATABASE_PATH');
  const appOrigin = required('APP_ORIGIN');
  const masterKey = Buffer.from(env.NFSE_MASTER_KEY ?? '', 'base64');
  if (masterKey.length !== 32) problems.push('NFSE_MASTER_KEY must be 32 bytes in base64');

  let auth: AuthConfig = { mode: 'dev', email: '' };
  if (env.AUTH_MODE === 'access') {
    auth = {
      mode: 'access',
      teamDomain: required('CF_ACCESS_TEAM_DOMAIN'),
      audience: required('CF_ACCESS_AUD'),
    };
  } else if (env.AUTH_MODE === 'dev') {
    if (nodeEnv === 'production') {
      problems.push('AUTH_MODE=dev is not allowed with NODE_ENV=production');
    }
    if (!env.DEV_USER_EMAIL) problems.push('DEV_USER_EMAIL is required with AUTH_MODE=dev');
    auth = { mode: 'dev', email: (env.DEV_USER_EMAIL ?? '').toLowerCase() };
  } else {
    problems.push('AUTH_MODE must be access or dev');
  }

  const fake = env.NACIONAL_FAKE_URL;
  if (fake && nodeEnv === 'production') {
    problems.push('NACIONAL_FAKE_URL is not allowed with NODE_ENV=production');
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    nodeEnv: nodeEnv as Config['nodeEnv'],
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3000),
    databasePath,
    appOrigin,
    masterKey,
    auth,
    ...(fake ? { nacionalUrls: { sefin: `${fake}/SefinNacional`, adn: `${fake}/adn` } } : {}),
  };
}
