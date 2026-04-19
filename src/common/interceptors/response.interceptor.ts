import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../interfaces/api-response.interface';

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((value: any) => {
        // Pass-through: already shaped as ApiResponse
        if (
          value &&
          typeof value === 'object' &&
          typeof (value as any).success === 'boolean'
        ) {
          return value as ApiResponse<T>;
        }

        // If controller returned `{ message, ...rest }`, extract message
        if (
          value &&
          typeof value === 'object' &&
          typeof (value as any).message === 'string'
        ) {
          const { message, ...rest } = value as any;
          const hasOtherKeys = Object.keys(rest).length > 0;
          return {
            success: true,
            message,
            data: hasOtherKeys ? rest : undefined,
          } as ApiResponse<T>;
        }

        return { success: true, data: value } as ApiResponse<T>;
      }),
    );
  }
}
