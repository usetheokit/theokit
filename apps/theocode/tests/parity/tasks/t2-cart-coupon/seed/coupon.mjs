/** Applies a percentage coupon to a total. */
export function applyCoupon(total, percent) {
  return total - (total * percent) / 100
}
