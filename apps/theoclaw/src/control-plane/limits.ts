/**
 * The largest message the control plane accepts on any surface: one `/control` frame, one WebChat
 * post. A message, not a file. One constant, so the two bounds cannot drift apart.
 */
export const MAX_MESSAGE_BYTES = 65_536
