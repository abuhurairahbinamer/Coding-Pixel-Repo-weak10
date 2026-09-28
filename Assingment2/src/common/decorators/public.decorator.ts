import { SetMetadata } from "@nestjs/common";

// ============================================================================
// [X2] CHALLENGE REQUIREMENT: Invert the default with @Public() decorator
// WHY: Protected by default means a forgotten guard fails closed.
// Open by default means a forgotten guard fails open.
// HINT: A global guard plus a metadata key that the guard reads with Reflector.
// CHECK: A newly added route with no decorators requires a token, and only the
// routes marked @Public() (e.g. register, login, refresh) answer without one.
// ============================================================================
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
