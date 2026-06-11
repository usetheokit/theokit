/**
 * TheoKit App — opinionated, React-first.
 *
 * React SSR renders app/page.tsx inside app/layout.tsx.
 * Backend classes registered in server/index.ts.
 * Routes inferred from class names. Zero manual wiring.
 */
import 'reflect-metadata'
import { renderToString } from 'react-dom/server'
import { TheoApp } from '@theokit/http/app'
import { TasksController, AssistantAgent, TaskTools } from './server/index.js'
import Layout from './app/layout.js'
import Page from './app/page.js'

const html =
  '<!DOCTYPE html>' +
  renderToString(
    <Layout>
      <Page />
    </Layout>,
  )

const app = await TheoApp.create({
  controllers: [TasksController],
  agents: [AssistantAgent],
  providers: [TaskTools],
  html,
})

await app.listen(3000)
