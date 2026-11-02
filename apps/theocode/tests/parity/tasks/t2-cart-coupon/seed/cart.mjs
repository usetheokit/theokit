const items = []

export function createCart() {
  return {
    add(name, price) {
      items.push({ name, price })
    },
    total() {
      return items.reduce((sum, item) => sum + item.price, 0)
    },
  }
}
