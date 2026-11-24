import { GrantStore } from '../../src/mcp-relay/grants.js'

// Child process for the cross-process lock test: creates `count` uniquely named grants in one file.
const [path, prefix, countText] = process.argv.slice(2)
const store = new GrantStore(path!)
for (let i = 0; i < Number(countText); i++) await store.create(`${prefix}-${i}`)
