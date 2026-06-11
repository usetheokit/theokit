/**
 * HttpErrorFilter — custom error response format.
 * Catches HttpException and returns structured JSON.
 */
import { Catch, HttpException, type ExceptionFilter, type ArgumentsHost } from '@theokit/http'

@Catch(HttpException)
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, _host: ArgumentsHost): Response {
    const ex = exception as HttpException
    return new Response(JSON.stringify({
      success: false,
      error: { code: ex.statusCode, message: ex.message },
      timestamp: new Date().toISOString(),
    }), {
      status: ex.statusCode,
      headers: { 'content-type': 'application/json' },
    })
  }
}
