// ============================================================================
// [C3] CORE REQUIREMENT: Parameter Validation Pipe
// Validates that route parameters (e.g. :id, :userId, :taskId) are strictly positive
// integers (> 0) before reaching the controller logic or database layer.
// Rejects zero, negative integers, floats, and non-numeric strings with 400 Bad Request.
// ============================================================================
import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from "@nestjs/common";

@Injectable()
export class ParsePositiveIntPipe implements PipeTransform<string | number, number> {
  transform(value: string | number, metadata: ArgumentMetadata): number {
    const paramName = metadata.data ?? "id";
    const strValue = String(value).trim();

    // Check if string consists purely of digits
    if (!/^\d+$/.test(strValue)) {
      throw new BadRequestException(
        `Validation failed: parameter '${paramName}' must be a positive integer, received: '${strValue}'`,
      );
    }

    const parsed = parseInt(strValue, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(
        `Validation failed: parameter '${paramName}' must be greater than zero, received: '${strValue}'`,
      );
    }

    return parsed;
  }
}
