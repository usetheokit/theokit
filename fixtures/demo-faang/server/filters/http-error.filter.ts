import type { ExceptionFilter, ArgumentsHost } from '../../../../packages/http/src/bridge/exception-filter-chain.js'
import { HttpException, Catch } from '../../../../packages/http/src/index.js'

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
