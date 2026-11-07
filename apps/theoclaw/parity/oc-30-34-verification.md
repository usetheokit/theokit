# OC-30 to OC-34 verification status

On 2026-11-07 the requester directed that any of these rows whose real-model
evidence cannot be named be recorded as out. `human/requester` identifies that
instruction; no personal name was supplied.

Implemented and covered by offline tests: `apps/theoclaw/install.sh`,
`theoclaw onboard`, `theoclaw daemon`, `theoclaw update` and the Dockerfile.
The registry half of OC-30 (`npm i -g theoclaw`) is out by owner decision
2026-11-02: the install is the source install, `apps/theoclaw/install.sh`.

The earlier "shipped" marks cited a dispatched CI run, but this checkout holds
no transcript of it and no model name, and the sandbox has no Docker or model
key to rerun it. They are therefore out until rerun:

- OC-30, OC-31, OC-34: `THEOCLAW_CONTAINER=1`, Docker, `OPENROUTER_API_KEY`,
  `THEOCLAW_MODEL`, `tests/container/install.container.test.ts`.
- OC-33: the same variables, `tests/container/image.container.test.ts`.
- OC-32: `THEOCLAW_LIVE=1`, a Linux host with systemd --user and a model key,
  `tests/live/daemon.live.test.ts`.

Record the passing run's transcript (install exit 0, onboarding config written,
reply within 60 seconds) and the actual model name here and in the ledger before
marking any row shipped.
