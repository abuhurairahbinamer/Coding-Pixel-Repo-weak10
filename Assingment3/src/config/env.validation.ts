// ============================================================================
// Week 10 Assignment 3: Production Hardening
// [W1] WARM-UP REQUIREMENT: Environment configuration schema validation with Joi
// [C2] CORE REQUIREMENT: Strict type coercion and validation at the config boundary
// ============================================================================
import Joi from "joi";

export interface EnvironmentVariables {
  NODE_ENV: "development" | "production" | "test";
  PORT: number;
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  FRONTEND_URL: string;
  JWT_SECRET: string;
  JWT_ACCESS_EXPIRATION_TIME: string;
  JWT_REFRESH_EXPIRATION_TIME: string;
  ARGON2_TIME_COST: number;
  ARGON2_MEMORY_COST: number;
  ARGON2_PARALLELISM: number;
  THROTTLE_TTL: number;
  THROTTLE_LIMIT: number;
  THROTTLE_AUTH_LIMIT: number;
}

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "production", "test")
    .default("development"),

  // [C2] Check: PORT='abc' is rejected at boot with a type error; valid number boots
  PORT: Joi.number().port().default(3000),

  // [W1] Check: Removing a required variable makes application fail to start, naming the variable
  DB_HOST: Joi.string().required().messages({
    "any.required": '"DB_HOST" is required',
  }),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required().messages({
    "any.required": '"DB_USERNAME" is required',
  }),
  DB_PASSWORD: Joi.string().required().messages({
    "any.required": '"DB_PASSWORD" is required',
  }),
  DB_NAME: Joi.string().required().messages({
    "any.required": '"DB_NAME" is required',
  }),

  FRONTEND_URL: Joi.string().uri({ scheme: ["http", "https"] }).default("http://localhost:3000"),

  JWT_SECRET: Joi.string().required().messages({
    "any.required": '"JWT_SECRET" is required',
  }),
  JWT_ACCESS_EXPIRATION_TIME: Joi.string().default("15m"),
  JWT_REFRESH_EXPIRATION_TIME: Joi.string().default("7d"),

  ARGON2_TIME_COST: Joi.number().integer().min(1).default(3),
  ARGON2_MEMORY_COST: Joi.number().integer().min(1024).default(65536),
  ARGON2_PARALLELISM: Joi.number().integer().min(1).default(1),

  THROTTLE_TTL: Joi.number().integer().min(1).default(60000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),
  THROTTLE_AUTH_LIMIT: Joi.number().integer().min(1).default(5),
});

/**
 * Validates raw configuration against the schema.
 * Throws a formatted Error detailing each failed field if invalid.
 */
export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const { error, value } = envValidationSchema.validate(config, {
    abortEarly: false,
    allowUnknown: true,
  });

  if (error) {
    const errorDetails = error.details.map((d) => d.message).join(", ");
    throw new Error(`[Config Validation Error] Configuration schema validation failed: ${errorDetails}`);
  }

  return value as EnvironmentVariables;
}
