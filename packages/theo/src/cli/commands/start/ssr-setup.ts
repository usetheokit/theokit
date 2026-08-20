/**
 * SSR setup stage for `theokit start` (T4.2 architecture-cleanup).
 *
 * Loads the SSR entry-server module if configured + builds template split
 * around the React root div. Returns null renderers when SSR is disabled.
 */

import type { ServerResponse } from 'node:http'

import { findRootDiv } from '../../../core/contracts/find-root-div.js'

import { resolveSsrEntry } from './bootstrap-stages.js'

export interface SsrRenderResult {
  html: string
  hydrationData: {
    loaderData?: unknown
    actionData?: unknown
    errors?: unknown
  }
}

export type RenderStreamingResult = { redirect: Response } | { streaming: true } | undefined

export type SsrRender = (
  url: string,
  options?: { nonce?: string },
) => Promise<SsrRenderResult | { redirect: Response } | string>

export type SsrRenderStreaming = (
  url: string,
  response: ServerResponse,
  options?: {
    signal?: AbortSignal
    nonce?: string
    /**
     * The template up to and including `<div id="root">`, written before React
     * produces a byte. Without it the streamed response is React's output alone
     * — no `<html>`, no `<head>` (usetheokit/theokit#343).
     */
    htmlHead?: string
    /** The template after `</div>`, written after the hydration data script. */
    htmlTail?: string
  },
) => Promise<RenderStreamingResult>

interface SsrSetupResult {
  enabled: boolean
  streamingEnabled: boolean
  render: SsrRender | null
  renderStreaming: SsrRenderStreaming | null
  htmlHead: string
  htmlTail: string
}

export function isSsrRenderResult(value: unknown): value is SsrRenderResult {
  if (typeof value !== 'object' || value === null) return false
  if (!('html' in value)) return false
  const html = (value as Record<string, unknown>).html
  if (typeof html !== 'string') return false
  return true
}

interface SsrEntryServer {
  render: SsrRender
  renderStreaming?: SsrRenderStreaming
}

export async function setupSsr(opts: {
  distDir: string
  indexHtml: string
  ssrConfigEnabled: boolean
  ssrStreamingConfig: boolean | undefined
}): Promise<SsrSetupResult> {
  const ssrServerPath: string | null = opts.ssrConfigEnabled ? resolveSsrEntry(opts.distDir) : null
  const enabled = ssrServerPath !== null
  const streamingEnabled = enabled && Boolean(opts.ssrStreamingConfig)

  if (ssrServerPath === null) {
    return {
      enabled: false,
      streamingEnabled: false,
      render: null,
      renderStreaming: null,
      htmlHead: '',
      htmlTail: '',
    }
  }

  const mod = (await import(ssrServerPath)) as SsrEntryServer
  const render = mod.render
  const renderStreaming = typeof mod.renderStreaming === 'function' ? mod.renderStreaming : null

  // Split HTML template on root div
  let htmlHead = ''
  let htmlTail = ''
  const rootDiv = findRootDiv(opts.indexHtml)
  if (rootDiv) {
    htmlHead = opts.indexHtml.slice(0, rootDiv.insertAt)
    htmlTail = opts.indexHtml.slice(rootDiv.insertAt)
  }

  return { enabled, streamingEnabled, render, renderStreaming, htmlHead, htmlTail }
}
