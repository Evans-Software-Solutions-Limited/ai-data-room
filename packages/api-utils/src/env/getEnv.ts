/**
 * Get the raw value of an environment variable. Does not throw if the variable is not set.
 */
export function getEnvRaw(name: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(process.env, name)) {
    return undefined;
  }

  return process.env[name];
}

/**
 * Get the value of an environment variable. Throws if the variable is not set.
 */
export function getEnv(name: string): string {
  const value = getEnvRaw(name);

  if (value === undefined) {
    throw new Error("Missing environment variable for " + name);
  }

  return value;
}

/**
 * Get the value of an environment variable. Returns the default value if the variable is not set.
 */
export function getEnvOrDefault(name: string, defaultValue: string): string {
  const value = getEnvRaw(name);

  if (value === undefined) {
    return defaultValue;
  }

  return value;
}
