export type AuthLimits = {
  loginLimitPerEmail: number;
  loginLimitPerIp: number;
  loginWindowMs: number;
  sessionTtlMs: number;
  passwordMinLength: number;
  passwordMaxLength: number;
};

export const authDefaults: AuthLimits = {
  loginLimitPerEmail: 10,
  loginLimitPerIp: 30,
  loginWindowMs: 15 * 60 * 1000,
  sessionTtlMs: 12 * 60 * 60 * 1000,
  passwordMinLength: 12,
  passwordMaxLength: 128,
};

export const sessionCookieName = "wolf_session";
