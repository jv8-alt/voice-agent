export interface TaskApiConfig {
  readonly openAiApiKey: string;
  readonly port: number;
  readonly webOrigin: string;
  readonly demoRepoId: string;
}

export type TaskApiEnvironment = Readonly<Record<string, string | undefined>>;

function required(environment: TaskApiEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function parsePort(environment: TaskApiEnvironment): number {
  const raw = required(environment, 'PORT');
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseWebOrigin(environment: TaskApiEnvironment): string {
  const raw = required(environment, 'WEB_ORIGIN');
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    throw new Error('WEB_ORIGIN must be an absolute HTTP(S) URL');
  }

  if ((origin.protocol !== 'http:' && origin.protocol !== 'https:') || origin.origin !== raw) {
    throw new Error('WEB_ORIGIN must be an HTTP(S) origin without a path');
  }
  return origin.origin;
}

export function parseTaskApiConfig(environment: TaskApiEnvironment): TaskApiConfig {
  return {
    openAiApiKey: required(environment, 'OPENAI_API_KEY'),
    port: parsePort(environment),
    webOrigin: parseWebOrigin(environment),
    demoRepoId: required(environment, 'DEMO_REPO_ID'),
  };
}
