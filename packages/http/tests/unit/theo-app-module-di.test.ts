/* eslint-disable @typescript-eslint/no-extraneous-class -- empty @Module classes are the metadata carriers */
import 'reflect-metadata'
import { Container, Injectable, Module, PreDestroy } from '@theokit/di'
import { describe, expect, it } from 'vitest'

import { Controller, Get, Public, TheoApp } from '../../src/index.js'

const deps = (C: Function, ...d: Function[]) => {
  Injectable()(C as never)
  Reflect.defineMetadata('design:paramtypes', d, C)
}
const mod = (C: Function, meta: object) => Module(meta as never)(C as never)

function setup() {
  class Db {
    url = 'configured'
    closed = false
    destroy() {
      this.closed = true
    }
  }
  class Svc {
    constructor(readonly db: Db) {}
  }
  deps(Db)
  deps(Svc, Db)
  PreDestroy(Db.prototype, 'destroy')
  return { Db, Svc }
}

function makeController(...d: Function[]) {
  class Ctl {
    constructor(readonly svc: unknown) {}
    ping() {
      return 'x'
    }
  }
  Controller('ctl')(Ctl)
  Public()(Ctl)
  Get('ping')(Ctl.prototype, 'ping', Object.getOwnPropertyDescriptor(Ctl.prototype, 'ping')!)
  Reflect.defineMetadata('design:paramtypes', d, Ctl)
  return Ctl
}

const routesOf = (app: TheoApp) =>
  (app as unknown as { routes: { instance: { svc: { db: { url: string } } } }[] }).routes

describe('TheoApp.create({ module }) uses @theokit/di', () => {
  it('injects provider dependencies', async () => {
    const { Db, Svc } = setup()
    class AppModule {}
    mod(AppModule, { providers: [Db, Svc] })
    const app = await TheoApp.create({
      controllers: [makeController(Svc)],
      module: AppModule,
      staticDir: false,
    })
    expect(routesOf(app)[0]!.instance.svc.db.url).toBe('configured')
    await app.close()
  })

  it('resolves providers from a module imported two levels deep', async () => {
    const { Db, Svc } = setup()
    class Deep {}
    mod(Deep, { providers: [Db], exports: [Db] })
    class Mid {}
    mod(Mid, { imports: [Deep], providers: [Svc], exports: [Svc] })
    class Root {}
    mod(Root, { imports: [Mid] })
    const app = await TheoApp.create({
      controllers: [makeController(Svc)],
      module: Root,
      staticDir: false,
    })
    expect(routesOf(app)[0]!.instance.svc.db.url).toBe('configured')
    await app.close()
  })

  it('rejects with the container error when a provider is missing', async () => {
    const { Svc } = setup()
    class Empty {}
    mod(Empty, { providers: [] })
    await expect(
      TheoApp.create({ controllers: [makeController(Svc)], module: Empty, staticDir: false }),
    ).rejects.toMatchObject({ name: 'TokenNotFoundError' })
  })

  it('runs @PreDestroy on close()', async () => {
    const { Db, Svc } = setup()
    class AppModule {}
    mod(AppModule, { providers: [Db, Svc] })
    const app = await TheoApp.create({
      controllers: [makeController(Svc)],
      module: AppModule,
      staticDir: false,
    })
    const db = routesOf(app)[0]!.instance.svc.db as unknown as { closed: boolean }
    await app.close()
    expect(db.closed).toBe(true)
  })

  it('uses a passed container and leaves its disposal to the caller', async () => {
    const { Db, Svc } = setup()
    class AppModule {}
    mod(AppModule, { providers: [Db, Svc] })
    const container = new Container()
    const app = await TheoApp.create({
      controllers: [makeController(Svc)],
      module: AppModule,
      container: container as never,
      staticDir: false,
    })
    const db = routesOf(app)[0]!.instance.svc.db as unknown as { closed: boolean }
    await app.close()
    expect(db.closed).toBe(false)
    await container.dispose()
    expect(db.closed).toBe(true)
  })

  it('refuses an inline provider with constructor dependencies and no container', async () => {
    const { Db, Svc } = setup()
    await expect(
      TheoApp.create({ controllers: [], providers: [Db, Svc], staticDir: false }),
    ).rejects.toThrow(/constructor dependencies/)
  })
})
