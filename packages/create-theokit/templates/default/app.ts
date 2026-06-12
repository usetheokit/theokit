/**
 * TheoKit App — manual bootstrap (optional).
 *
 * `theokit dev` auto-discovers server/routes/ — you don't need this file
 * for basic usage. Use it when you need explicit controller/agent registration.
 *
 * Example with controllers + agents:
 *
 *   import 'reflect-metadata'
 *   import { TheoApp } from '@theokit/http/app'
 *   import { MyController } from './server/controllers/my.controller.js'
 *
 *   const app = await TheoApp.create({ controllers: [MyController] })
 *   await app.listen(3000)
 */
