import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import {
  Req,
  Res,
  Body,
  Param,
  Query,
  Headers,
  Session,
  Ip,
  HostParam,
} from '../../src/decorators/params.js'
import { getMeta, ROUTE_PARAMS } from '../../src/metadata/index.js'
import type { ParamEntry } from '../../src/decorators/params.js'

function getParams(target: Function, method: string): ParamEntry[] {
  const map = getMeta<Map<string | symbol, ParamEntry[]>>(ROUTE_PARAMS, target)
  return map?.get(method) ?? []
}

describe('T2.1 — Parameter decorators', () => {
  it('test_each_param_decorator stores correct source', () => {
    const cases: Array<[Function, string]> = [
      [Req, 'req'],
      [Body, 'body'],
      [Param, 'param'],
      [Query, 'query'],
      [Headers, 'headers'],
      [Session, 'session'],
      [Ip, 'ip'],
      [HostParam, 'host'],
    ]
    for (const [decorator, expectedSource] of cases) {
      class Ctrl {
        handler(@((decorator as ReturnType<typeof Req>)()) _val: unknown) {}
      }
      const entries = getParams(Ctrl, 'handler')
      expect(entries).toHaveLength(1)
      expect(entries[0].source).toBe(expectedSource)
      expect(entries[0].index).toBe(0)
    }
  })

  it('test_multiple_params_per_method', () => {
    class Ctrl {
      handler(@Body() _body: unknown, @Param('id') _id: string) {}
    }
    const entries = getParams(Ctrl, 'handler')
    expect(entries).toHaveLength(2)
    // Decorator order is reverse because TS evaluates right-to-left
    const sorted = [...entries].sort((a, b) => a.index - b.index)
    expect(sorted[0].source).toBe('body')
    expect(sorted[0].index).toBe(0)
    expect(sorted[1].source).toBe('param')
    expect(sorted[1].key).toBe('id')
    expect(sorted[1].index).toBe(1)
  })

  it('test_res_passthrough', () => {
    class Ctrl {
      handler(@Res({ passthrough: true }) _res: unknown) {}
    }
    const entries = getParams(Ctrl, 'handler')
    expect(entries[0].source).toBe('res')
    expect(entries[0].passthrough).toBe(true)
  })

  it('test_walk_handles_param_index_gap (EC-7)', () => {
    class Ctrl {
      // index 0 = decorated, index 1 = undecorated, index 2 = decorated
      handler(@Param('id') _id: string, _ctx: unknown, @Headers('x') _hdr: string) {}
    }
    const entries = getParams(Ctrl, 'handler')
    // Only decorated params stored (2, not 3)
    expect(entries).toHaveLength(2)
    const sorted = [...entries].sort((a, b) => a.index - b.index)
    expect(sorted[0].index).toBe(0)
    expect(sorted[1].index).toBe(2)
    // Index 1 is absent — bridge must handle gracefully
  })
})
