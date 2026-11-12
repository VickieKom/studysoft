import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  // Derives access-link tokens (#19). Rotating it invalidates every link at once.
  LINK_KEY: z.string().min(32, "LINK_KEY must be at least 32 characters"),
  APP_URL: z.url({ protocol: /^https?$/ }),
  // Required: an image built without it must fail to start, not report "dev".
  BUILD_SHA: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment: ${fields}`);
  }
  return result.data;
}

let cached: Env | undefined;

// Read lazily: `next build` imports server modules without a runtime environment.
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
