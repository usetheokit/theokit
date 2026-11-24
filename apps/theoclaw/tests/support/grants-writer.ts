import { createGrantStore } from '@theokit/http/guards'

// Child process for the cross-process lock test: creates `count` uniquely named grants in one file.
const [path, prefix, countText] = process.argv.slice(2)
const store = createGrantStore(path!)
for (let i = 0; i < Number(countText); i++) await store.create(`${prefix}-${i}`, ['list_dir'])
