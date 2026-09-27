// ============================================================================
// [W1] & [C5] Custom Throttler Storage with Isolation & Reset Support
// Provides memory-based throttler storage with a central reset() hook
// allowing test suites to isolate state and prevent cross-test 429 inheritance.
// ============================================================================
import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { ThrottlerStorageService } from "@nestjs/throttler";

@Injectable()
export class AppThrottlerStorage
  extends ThrottlerStorageService
  implements OnApplicationShutdown
{
  private static globalStorageInstance: AppThrottlerStorage | null = null;

  constructor() {
    super();
    AppThrottlerStorage.globalStorageInstance = this;
  }

  /**
   * Clears all active rate-limiting records from in-memory storage.
   * Enables clean test isolation between test cases.
   */
  static reset(): void {
    if (AppThrottlerStorage.globalStorageInstance) {
      AppThrottlerStorage.globalStorageInstance.storage.clear();
    }
  }
}
