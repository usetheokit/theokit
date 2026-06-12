/**
 * TheoKit App — opinionated, React-first, full-stack AI agents.
 *
 * To customize: edit app/layout.tsx (head, title, meta)
 *               edit app/page.tsx (page content)
 *               edit server/ (controllers, agents, toolboxes)
 */
import { TheoApp } from '@theokit/http/app'
import { TasksController, AssistantAgent, TaskTools } from './server/index.js'
import Layout from './app/layout.js'
import Page from './app/page.js'

const app = await TheoApp.create({
  controllers: [TasksController],
  agents: [AssistantAgent],
  providers: [TaskTools],
  root: (
    <Layout>
      <Page />
    </Layout>
  ),
})

await app.listen(3000)
