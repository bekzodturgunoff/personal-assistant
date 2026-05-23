type EnvLike = Record<string, unknown>;

declare global {
  // eslint-disable-next-line no-var
  var __OCTOPOS_ENV__: EnvLike | undefined;
}

export function setRuntimeEnv(env: EnvLike): void {
  globalThis.__OCTOPOS_ENV__ = env;
}

export function getEnv(name: string): string | undefined {
  const runtimeEnv = globalThis.__OCTOPOS_ENV__;
  const runtimeValue = runtimeEnv?.[name];
  if (typeof runtimeValue === 'string' && runtimeValue.length > 0) {
    return runtimeValue;
  }

  if (typeof process !== 'undefined' && process.env) {
    const processValue = process.env[name];
    if (typeof processValue === 'string' && processValue.length > 0) {
      return processValue;
    }
  }

  return undefined;
}

export function getBinding<T = unknown>(name: string): T | undefined {
  return globalThis.__OCTOPOS_ENV__?.[name] as T | undefined;
}
