/**
 * Frontend page — how a consumer uses the auto-typed client.
 *
 * In a real TheoKit app with the client bridge:
 *
 *   import { client } from '@theo/client'
 *
 *   // Auto-typed from @Controller('tasks') + @Get()
 *   const tasks = await client.tasks.get()
 *   const newTask = await client.tasks.post({ body: { title: 'New', priority: 'high' } })
 *   const stats = await client.tasks.stats.get({ headers: { authorization: 'Bearer token' } })
 *
 * The typed client is auto-generated in .theo/client.d.ts by the
 * appTypedClientPlugin with extraRoutes from the decorator bridge.
 * Both defineRoute file-routes and @Controller decorator-routes
 * appear in the SAME client object.
 */

export default function TasksPage() {
  return (
    <div>
      <h1>TheoKit Task Manager</h1>
      <p>Built with @theokit/http-decorators</p>

      {/* In production:
        const { data: tasks } = useQuery(['tasks'], () => client.tasks.get())
        const createTask = useMutation((body) => client.tasks.post({ body }))
      */}
    </div>
  )
}
