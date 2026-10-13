# OpenClaw capability inventory

**Purpose:** OBJ-6 measures TheoClaw against OpenClaw row by row. This file holds the rows,
so the comparison is against a fixed, cited list.

**Measured 2026-10-04** from a shallow clone of https://github.com/openclaw/openclaw at
`9a7b4dab5f10058df4d5f47857764323572be7c4` (HEAD commit 2026-10-04T06:56:10-07:00),
`package.json` version `2026.9.8`, latest remote tag `v2026.9.8`. MIT, OpenClaw Foundation.
TypeScript on Node `>=24.16.0 <25 || >=26.1.0`, pnpm workspace; native apps in Swift
(macOS/iOS), Kotlin (Android), Tauri/Rust (Linux). 174 directories under `extensions/`
(channels, providers and tools ship as plugins), 50 bundled skills under `skills/`.

**Labels.** *Observed* means the mechanism was read in source at the cited path. *Reported*
means only the repository's own `docs/` (mirrored at docs.openclaw.ai) claims it. Nothing was
run: behaviour is read from code, not exercised.

## Rows

| # | Area | Capability | How OpenClaw does it | Evidence | Label |
|---|---|---|---|---|---|
| OC-1 | Channels | WhatsApp | plugin over WhatsApp Web via `baileys` | extensions/whatsapp/openclaw.plugin.json:9 | Observed |
| OC-2 | Channels | Telegram | plugin on `grammy` with throttler; docs list it as core | extensions/telegram/openclaw.plugin.json:5 | Observed |
| OC-3 | Channels | Slack | `@slack/bolt` and web-api: channels, DMs, commands, app events | extensions/slack/openclaw.plugin.json:10 | Observed |
| OC-4 | Channels | Discord | discord-api-types + ws, `@discordjs/voice`, Activities | extensions/discord/openclaw.plugin.json:16 | Observed |
| OC-5 | Channels | Signal | drives the `signal-cli` binary | extensions/signal/src/accounts.ts:242 | Observed |
| OC-6 | Channels | iMessage | `imsg` CLI on a signed-in Mac, remote variant over ssh | extensions/imessage/src/remote-host.ts:12 | Observed |
| OC-7 | Channels | Microsoft Teams | `@microsoft/teams.apps` (Bot Framework) | extensions/msteams/openclaw.plugin.json:15 | Observed |
| OC-8 | Channels | Matrix | `matrix-js-sdk` with E2EE crypto | extensions/matrix/openclaw.plugin.json:14 | Observed |
| OC-9 | Channels | Google Chat | spaces and DMs via google-auth-library | extensions/googlechat/openclaw.plugin.json:8 | Observed |
| OC-10 | Channels | Other official channels | IRC, LINE, Mattermost, Nextcloud Talk, Nostr (NIP-04), Feishu/Lark, Synology Chat, Tlon/Urbit, Twitch, Zalo, Zalo Personal, SMS/MMS (Twilio), ClickClack, Buzz | extensions/*/openclaw.plugin.json | Observed |
| OC-11 | Channels | Out-of-repo channels | WeChat, WeCom, Yuanbao, Zalo ClawBot; QQ Bot doc only | docs/channels/wechat.md, docs/channels/qqbot.md | Reported |
| OC-12 | Channels | WebChat / Control UI | browser chat served by the gateway over WS | src/gateway/server/connection.ts:435 | Observed |
| OC-13 | Channels | Agent to agent (A2A v1.0) | A2A channel with peer auth, discovery, task delivery | extensions/a2a/openclaw.plugin.json:5 | Observed |
| OC-14 | Channels | Reef (claw-to-claw, E2EE) | relay with @noble crypto and instance "friendships" | extensions/reef/openclaw.plugin.json:15 | Observed |
| OC-15 | Channels | Telephony | calls through Twilio, Telnyx, Plivo | extensions/voice-call/openclaw.plugin.json:9 | Observed |
| OC-16 | Channels | Joining meetings | Google Meet, Teams and Zoom as a Chrome guest, Slack huddles, FaceTime (experimental) | extensions/{google-meet,teams-meetings,zoom-meetings,slack-huddles,facetime} | Observed |
| OC-17 | Channels | E-mail trigger | watches IMAP inboxes, dispatches to an isolated session with a restricted reader agent | extensions/imap/index.ts:14 | Observed |
| OC-18 | Channel security | DM policy | `pairing` (default), `allowlist`, `open`, `disabled` | src/channels/plugins/dm-access.ts:6 | Observed |
| OC-19 | Channel security | Sender pairing | 1h TTL code approved with `openclaw pairing approve` | src/pairing/pairing-store.ts:26 | Observed |
| OC-20 | Groups | Group activation | `mention` or `always`, `/activation`, `requireMention`, `groupPolicy`, `groupAllowFrom` | src/config/sessions/types.ts:521 | Observed |
| OC-21 | Groups | Broadcast groups | bounded agent threads across several channels | docs/channels/broadcast-groups.md | Reported |
| OC-22 | Gateway | Local control plane | one process, WS + HTTP, default port 18789 | src/config/paths.ts:297 | Observed |
| OC-23 | Gateway | Safe bind by default | `bind` defaults to `loopback` | src/gateway/net.ts:256 | Observed |
| OC-24 | Gateway | Remote access | Tailscale serve/funnel, SSH tunnel, trusted-proxy auth | src/config/types.gateway.ts:71 | Observed |
| OC-25 | Gateway | LAN discovery | Bonjour/mDNS announcement | extensions/bonjour/openclaw.plugin.json | Observed |
| OC-26 | Gateway | OpenAI-compatible HTTP API | `/v1/chat/completions`, `/v1/responses`, `/v1/models` | src/gateway/openai-http.ts:502 | Observed |
| OC-27 | Gateway | Tool invocation over HTTP | `/tools/invoke` route | src/gateway/tools-invoke-http.ts:28 | Observed |
| OC-28 | Gateway | Multiple gateways per host | profile, port and service label per gateway | docs/gateway/multiple-gateways.md | Reported |
| OC-29 | Gateway | Team / multi-user deploy | shared gateway, Cloudflare Access, GitHub identity, roles, `users` CLI | src/cli/users-cli.ts:42 | Observed |
| OC-30 | Install | Installer and npm | `install.sh` / `install.ps1` provision Node; `npm i -g openclaw` | README.md:26-42 | Reported |
| OC-31 | Install | Onboarding wizard | `openclaw onboard --install-daemon` checks model, creates workspace, configures gateway | src/commands/onboard.ts:2 | Observed |
| OC-32 | Install | OS daemon | launchd, systemd `--user`, Windows schtasks | src/daemon/systemd-install.ts:526 | Observed |
| OC-33 | Install | Containers and PaaS | Dockerfile, docker-compose, fly.toml, render.yaml; Podman, Kubernetes, Nix docs | Dockerfile:30 | Observed (Docker), Reported (rest) |
| OC-34 | Install | Update channels | `stable`, `extended-stable`, `beta`, `dev`; `openclaw update` | src/infra/update-channels.ts:8 | Observed |
| OC-35 | Install | Migration from other agents | imports Claude Code/Desktop and Hermes: instructions, MCP, skills, memories | extensions/migrate-claude, extensions/migrate-hermes | Observed |
| OC-36 | Platforms | OS support | macOS, Linux, Windows (native/WSL2), ChromeOS; iOS and Android nodes | docs/platforms/index.md:14-27 | Reported |
| OC-37 | Apps | macOS menu bar app | NSStatusItem, wake word via SwabbleKit | apps/macos/Sources/OpenClaw/StatusMenuController.swift:22 | Observed |
| OC-38 | Apps | iOS node | Talk over WebRTC realtime, Watch app, Share Extension, widget | apps/ios/Sources/Voice/TalkRealtimeWebRTCSession.swift:507 | Observed |
| OC-39 | Apps | Android node | pairing, chat, voice, device commands | apps/android/app | Observed (dir), Reported (features) |
| OC-40 | Apps | Linux companion, Windows hub | Tauri app; Windows hub lives in another repo | apps/linux/src-tauri | Observed (Linux), Reported (Windows) |
| OC-41 | Apps | TUI | terminal UI, attached to the gateway or embedded | src/tui/tui.ts:3 | Observed |
| OC-42 | Nodes | Device commands | `camera.snap`, `screen.record`, `location.get`, `system.notify`, `system.run` via `node.invoke` | src/agents/tools/nodes-tool-commands.ts:18 | Observed |
| OC-43 | Nodes | File transfer between nodes | base64 over `node.invoke` | extensions/file-transfer/openclaw.plugin.json | Observed |
| OC-44 | Models | Providers | about 70 provider pages: Anthropic, OpenAI, Google, Bedrock, Vertex, Azure, OpenRouter, Groq, Mistral, DeepSeek, xAI, Qwen, Moonshot and more | docs/providers/ (73 files) | Observed |
| OC-45 | Models | Local and self-hosted | Ollama, llama.cpp, LM Studio, vLLM, SGLang, LiteLLM, Apple FM | extensions/{ollama,llama-cpp,lmstudio,vllm,sglang,litellm,apple-fm} | Observed |
| OC-46 | Models | Subscription auth, external harnesses | OAuth auth profiles; Claude CLI, Codex app-server, Copilot, OpenAI Agents API | src/agents/auth-profiles/repair.ts:47 | Observed |
| OC-47 | Models | Failover | `runWithModelFallback` with fallback list, cooldown, API key rotation | src/agents/model-fallback-runner.ts:136 | Observed |
| OC-48 | Models | Thinking levels | off to ultra; `/think`, `/reasoning`, `/fast` | src/auto-reply/thinking.shared.ts:13-22 | Observed |
| OC-49 | Runtime | Streaming and chunking | Markdown-aware chunker (code, tables); per-channel preview streaming | src/agents/embedded-agent-block-chunker.ts:2 | Observed |
| OC-50 | Runtime | Session scope | `dmScope`: main, per-peer, per-channel-peer, per-account-channel-peer; isolated groups | src/config/types.base.ts:31 | Observed |
| OC-51 | Runtime | Session storage | SQLite per agent, JSONL export | src/config/sessions/session-accessor.sqlite-archive-store.ts:221 | Observed |
| OC-52 | Runtime | Session reset and queueing | `session.reset.idleMinutes`; steer, followup, collect queues; `/new`, `/reset`, `/steer` | src/auto-reply/reply/queue/settings.ts:34 | Observed |
| OC-53 | Context | Compaction | staged summarisation, `/compact [instructions]` | src/agents/compaction.ts:269 | Observed |
| OC-54 | Context | Pruning | `contextPruning` trims old tool results | src/config/types.agent-defaults.ts:25 | Observed |
| OC-55 | Context | Persona and workspace files | SOUL.md, USER.md, HEARTBEAT.md, IDENTITY.md, AGENTS.md injected into the prompt | src/config/zod-schema.agent-defaults-base.ts:19-22 | Observed |
| OC-56 | Memory | Built-in memory | MEMORY.md indexed in SQLite with FTS/BM25 and `sqlite-vec`, hybrid search; `memory_search`, `memory_get` | extensions/memory-core/index.ts:220 | Observed |
| OC-57 | Memory | Alternative backends | LanceDB auto-capture and recall, Active Memory, Dreaming consolidation, Obsidian memory-wiki, Honcho | extensions/memory-lancedb/index.ts:35 | Observed (Honcho Reported) |
| OC-58 | Tools | Files and shell | read, write, edit, ls, apply_patch, exec, process (background, send-keys) | src/agents/core-tool-factory-descriptors.ts:15-21 | Observed |
| OC-59 | Tools | Core tool catalogue | about 60 tools: message, nodes, sessions_*, subagents, web_search/fetch, pdf, view_image, tts, ask_user, computer, secrets, goals, structured_output | src/agents/core-tool-factory-descriptors.ts:14-77 | Observed |
| OC-60 | Tools | Browser | dedicated Chrome via CDP, profiles, Chrome extension, Chrome MCP | extensions/browser/plugin-registration.ts:321 | Observed |
| OC-61 | Tools | Canvas and widgets | `canvas` tool, macOS-hosted widget panels, `show_widget` | extensions/canvas/src/tool-schema.ts:25 | Observed |
| OC-62 | Tools | Computer use | `computer` tool on gateway and nodes; experimental CUA driver | src/agents/tools/computer-tool.ts:187 | Observed |
| OC-63 | Tools | Web search | Brave, DuckDuckGo, Exa, Firecrawl, Perplexity, SearXNG, Tavily and more; readability `web_fetch` | extensions/{brave,duckduckgo,exa,firecrawl,searxng,tavily} | Observed |
| OC-64 | Tools | Media generation | `image_generate`, `video_generate`, `music_generate` | src/agents/tools/image-generate-tool.ts:283 | Observed |
| OC-65 | Tools | Code Mode and Swarm | QuickJS/WASM sandboxed JS orchestrating tools; `agents_wait` fan-out | extensions/code-mode-quickjs/index.ts:4 | Observed |
| OC-66 | Tools | Typed workflows | Lobster pipelines with resumable approvals; JSON-only `llm-task` | extensions/lobster/index.ts:2 | Observed |
| OC-67 | Tools | MCP | stdio/HTTP MCP client with OAuth; its own tools served as an MCP server | src/agents/mcp-oauth.ts, src/mcp/openclaw-tools-serve.ts:30 | Observed |
| OC-68 | Tools | ACP | Agent Client Protocol runtime (acpx), `/acp` | src/acp/translator.prompt-stream.ts:4 | Observed |
| OC-69 | Tools | Other utilities | diff viewer, document extraction, GitHub link preview, output compaction, workboard, screenshot logbook | extensions/{diffs,document-extract,github,tokenjuice,workboard,logbook} | Observed |
| OC-70 | Skills | Format and precedence | SKILL.md with seven precedence levels | docs/tools/skills.md:34-50 | Observed |
| OC-71 | Skills | Binary gating | `metadata.requires.bins` hides a skill whose dependency is missing | src/skills/discovery/bins.ts:8 | Observed |
| OC-72 | Skills | ClawHub registry | installs from clawhub.ai | src/skills/discovery/status.types.ts:2 | Observed |
| OC-73 | Skills | Agent-authored skills | `skill_workshop` tool and `/learn` turn work and corrections into a skill | src/agents/tools/skill-workshop-tool.ts:160 | Observed |
| OC-74 | Skills | Bundled skills | 50, including 1password, apple-notes, github, notion, obsidian, spotify, tmux, weather, whisper | skills/ | Observed |
| OC-75 | Plugins | Plugin SDK and manifest | `openclaw.plugin.json`, plugin-sdk, `openclaw plugins install` | src/plugins/installed-plugin-index-record-reader.ts:78 | Observed |
| OC-76 | Sandbox | Modes | `sandbox.mode` off (default), non-main, all; session/agent/shared scope; workspace none/ro/rw | src/agents/sandbox/types.ts:81 | Observed |
| OC-77 | Sandbox | Backends | Docker (default), Podman, remote SSH, OpenShell, Crabbox, Windows MXC; noVNC observer | src/agents/sandbox/config.ts:234 | Observed |
| OC-78 | Permissions | Exec approval | security deny/allowlist/full, ask off/on-miss/always, `exec-approvals.json`, model auto-reviewer | src/infra/exec-approvals-core.ts:12 | Observed |
| OC-79 | Permissions | Elevated mode and tool profiles | `/elevated` runs outside the sandbox; minimal, coding, messaging, full profiles; per-sender allow/deny | src/config/types.tools.ts:121 | Observed |
| OC-80 | Guardrails | Loop detection | `tools.loopDetection` for argument churn and no progress | src/agents/tool-loop-detection.ts | Observed |
| OC-81 | Multi-agent | Routing | bindings per channel, account and peer to isolated agents with their own workspace | src/config/types.agents.ts:9 | Observed |
| OC-82 | Multi-agent | Subagents and agent to agent | `sessions_spawn`, `sessions_send`, `sessions_list/history/search/yield`, `subagents`, `agents_list` | src/agents/tools/sessions-spawn-tool.ts:341 | Observed |
| OC-83 | Multi-agent | Cloud workers and worktrees | dispatches a turn to a disposable machine; managed git worktrees | src/config/types.cloud-workers.ts:1 | Observed |
| OC-84 | Automation | Cron | `croner` scheduler; `automations` tool; delivery by announce or webhook; `/loop` | src/cron/schedule.ts:4 | Observed |
| OC-85 | Automation | Heartbeat | periodic runner driven by HEARTBEAT.md; `heartbeat_respond` tool | src/infra/heartbeat-runner.ts | Observed |
| OC-86 | Automation | Webhooks and Gmail | `/hooks` route with mappings; Gmail Pub/Sub at `/gmail-pubsub` | src/gateway/hooks.ts:35 | Observed |
| OC-87 | Automation | Internal hooks, goals, standing orders | lifecycle and command hooks; per-session goals with token budget; standing authority | src/hooks/, docs/tools/goal.md | Observed (hooks), Reported (rest) |
| OC-88 | Security | Untrusted external content | wraps external content in `EXTERNAL_UNTRUSTED_CONTENT` | src/security/external-content.ts:37 | Observed |
| OC-89 | Security | Audit | `openclaw security audit` with fix | src/security/audit.ts:1086 | Observed |
| OC-90 | Security | Secrets | SecretRef over env, 1Password broker with SQLite audit, HashiCorp Vault; `secrets` tool | src/agents/tools/secrets-tool.ts:11 | Observed |
| OC-91 | Security | Device pairing | setup code and node approval | extensions/device-pair | Observed |
| OC-92 | Security | Incognito session | content kept out of logs, diagnostics and previews | docs/concepts/session.md:137 | Reported |
| OC-93 | Ops | Config | `~/.openclaw/openclaw.json` (JSON5, `$include`), `OPENCLAW_CONFIG_PATH` | src/config/paths.ts:141 | Observed |
| OC-94 | Ops | Hot reload | `gateway.reload.mode` hybrid (default) or off, debounced | src/gateway/config-reload-settings.ts:8 | Observed |
| OC-95 | Ops | Doctor, status, health | `openclaw doctor` with migration and repair, `status`, `health`, `/status` | src/commands/doctor.ts | Observed |
| OC-96 | Ops | Logs | `openclaw logs` tail over RPC with file and journal fallback; redaction | src/logging/redact.ts:1 | Observed |
| OC-97 | Ops | Usage and cost | `/usage off/tokens/full/cost`, per-provider usage, `costUsd` in events | src/infra/provider-usage.ts:1 | Observed |
| OC-98 | Ops | Telemetry | OTel metrics, traces and logs; Prometheus; opt-in anonymous telemetry | extensions/diagnostics-otel | Observed |
| OC-99 | Ops | Backup | `openclaw backup` local and offsite with SQLite snapshots | src/commands/backup.ts:1 | Observed |
| OC-100 | Voice | Talk mode | continuous conversation, local STT/TTS or realtime voice | src/talk/ | Observed |
| OC-101 | Voice | Wake word | gateway-wide wake words synced across nodes; Swabble on macOS | src/infra/voicewake.ts | Observed |
| OC-102 | Voice | TTS | `tts` tool and `/tts`; ElevenLabs, Azure, Inworld, Fish Audio, Edge, local CLI | src/agents/tools/tts-tool.ts:40 | Observed |
| OC-103 | Media | STT and transcription | inbound audio transcription (whisper-cli, Deepgram, OpenAI-compatible); realtime over WS | src/media-understanding/audio-transcription-runner.ts:2 | Observed |
| OC-104 | Media | Media understanding | image, audio, video, PDF and link understanding injected into context | src/link-understanding/apply.ts:1 | Observed |
| OC-105 | Chat UX | Slash commands | /help /status /model /think /reasoning /fast /elevated /compact /new /reset /stop /usage /tts /config /mcp /plugins /skill /learn /loop /goal /steer /export /approve /allowlist /acp and more | src/auto-reply/commands-registry.shared.ts:103-613 | Observed |
| OC-106 | Chat UX | Typing and reactions | `typingMode`, per-channel `ackReaction` | src/config/zod-schema.core.ts:434 | Observed |

## Not verified

- The release date of `2026.9.8`: the changelog carries none and the shallow clone has no tag history.
- A Homebrew install: not found in `docs/install/index.md`, so it is not claimed.
- The Windows hub, which lives in `openclaw/openclaw-windows-node` and was not read.
- Doc-only rows: WeChat, WeCom, Yuanbao, Zalo ClawBot, QQ Bot, Honcho, broadcast groups, incognito.
- Behaviour: whether every inbound path really wraps `EXTERNAL_UNTRUSTED_CONTENT`, how precise `/usage cost` is, and real cron concurrency.
- The provider count of about 70 counts files in `docs/providers/`; some pages cover speech or media rather than an LLM.
