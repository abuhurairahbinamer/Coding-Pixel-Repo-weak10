// ============================================================================
// [W1] WARM-UP REQUIREMENT: JwtAuthGuard built on passport-jwt reading Bearer token
// [X2] CHALLENGE REQUIREMENT: Global guard support with @Public() decorator bypass
// [C4] CORE REQUIREMENT: Runs before RolesGuard, returning 401 when token is missing
// ============================================================================
import { ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { Observable } from "rxjs";
import { IS_PUBLIC_KEY } from "../../common/decorators/public.decorator.js";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector?: Reflector) {
    super();
  }

  // [X2] If route is decorated with @Public(), allow access without token;
  // otherwise, [W1] enforce valid Bearer token, returning 401 if missing or invalid.
  override canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    if (this.reflector) {
      const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (isPublic) {
        return true;
      }
    }

    return super.canActivate(context);
  }
}
