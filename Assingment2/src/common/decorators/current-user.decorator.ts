import { createParamDecorator, ExecutionContext } from "@nestjs/common";

// ============================================================================
// [W2] WARM-UP REQUIREMENT: Add a @CurrentUser() parameter decorator
// Returns the authenticated user from the request.
// WHY: A userId sent in the request body is a claim from the client.
// The token is the only identity you have verified.
// JwtAuthGuard attaches the validated user to the request; this decorator reads it back.
// CHECK: A created resource is linked to the token's user even when the body carries
// a different userId, and @CurrentUser() resolves the right user.
// ============================================================================
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
