/**
 * Scripted parity turns, one per OC id (#1591). A scenario names the item, the surface
 * (`control`, `webchat`, `cli`, `matrix` or `mattermost`), what is sent and what the reply must match. Every CLI command
 * below exists in `src/cli.ts`. More scenarios, and transports for chat channels, plug in here.
 */
const PONG = { prompt: 'Reply with the single word: pong', match: 'pong' }

export const SCENARIOS = [
  {
    id: 'OC-22',
    surface: 'control',
    send: { message: PONG.prompt },
    expect: { match: PONG.match, flags: 'i' },
  },
  {
    id: 'OC-12',
    surface: 'webchat',
    send: { message: PONG.prompt },
    expect: { match: PONG.match, flags: 'i' },
  },
  // Chat platforms (#1672): a scripted human account DMs the bot; see chat-platforms.mjs for the variables.
  {
    id: 'matrix-dm-pong',
    surface: 'matrix',
    send: { message: PONG.prompt },
    expect: { match: PONG.match, flags: 'i' },
  },
  {
    id: 'mattermost-dm-pong',
    surface: 'mattermost',
    send: { message: PONG.prompt },
    expect: { match: PONG.match, flags: 'i' },
  },
  {
    // OC-31: `doctor` must pass right after `onboard`, with no edit in between.
    id: 'OC-31',
    surface: 'cli',
    send: {
      commands: [
        [
          'onboard',
          '--yes',
          '--model',
          '$MODEL',
          '--api-key-env',
          'THEOCLAW_PARITY_KEY',
          '--port',
          '0',
          '--owners',
          'telegram:owner',
          '--workspace',
          '$HOME/workspace',
        ],
        ['doctor'],
      ],
    },
    expect: { match: '^ok\\s', flags: 'm' },
  },
]
