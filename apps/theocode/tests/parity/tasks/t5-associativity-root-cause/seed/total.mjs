import { applyDiscount } from './discount.mjs'
import { applyTax } from './tax.mjs'

export const total = (amount, pct, rate) => applyTax(applyDiscount(amount, pct), rate)
