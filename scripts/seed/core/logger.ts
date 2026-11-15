export interface SeedLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const formatMeta = (meta?: Record<string, unknown>) => {
  if (!meta || Object.keys(meta).length === 0) return "";
  return ` ${JSON.stringify(meta)}`;
};

export const createSeedLogger = (prefix = "seed"): SeedLogger => ({
  info(message, meta) {
    console.log(`[${prefix}] ${message}${formatMeta(meta)}`);
  },
  warn(message, meta) {
    console.warn(`[${prefix}] ${message}${formatMeta(meta)}`);
  },
  error(message, meta) {
    console.error(`[${prefix}] ${message}${formatMeta(meta)}`);
  },
});
