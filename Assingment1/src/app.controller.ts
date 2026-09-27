import { Controller, Get } from "@nestjs/common";
import { AppService } from "./app.service.js";
import { Public } from "./common/decorators/public.decorator.js";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHealth(): { status: string; timestamp: string } {
    return this.appService.getHealth();
  }

  // [C1], [X2], [X3] Deliberate unhandled 500 endpoint to prove exception filtering,
  // secret redaction, and stack trace suppression across environments
  @Public()
  @Get("test-500")
  trigger500(): void {
    throw new Error(
      "Fatal database connection failure with password=SuperSecretDbPassword123 and token=Bearer_secret_token_123",
    );
  }
}
