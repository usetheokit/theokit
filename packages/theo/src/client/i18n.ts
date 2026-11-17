/**
 * i18n for `theokit/client`: typed dictionaries, a `t()` lookup, a provider, locale negotiation and
 * locale-aware formatting. A missing key in any locale is a TYPE error, so `tsc` (and the build's
 * typecheck) fails; no runtime check is needed.
 */
import { createContext, createElement, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

/** A dictionary: nested objects whose leaves are strings. */
export interface Dictionary {
  [key: string]: string | Dictionary
}

/** Dot-path keys of every string leaf in `T`. */
export type DictionaryKey<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends object
      ? `${K}.${DictionaryKey<T[K]>}`
      : never
}[keyof T & string]

/** Same shape as `T` (same keys at every level), any string values. */
export type SameShape<T> = { [K in keyof T]: T[K] extends string ? string : SameShape<T[K]> }

export interface I18nConfig<T extends Record<string, Dictionary>, DL extends keyof T & string> {
  readonly defaultLocale: DL
  /** Every locale must have every key the default locale has. */
  readonly dictionaries: T & { readonly [K in keyof T]: SameShape<T[DL]> }
  /** localStorage key for the stored preference. Default `theokit.locale`. */
  readonly storageKey?: string
}

export type TranslateParams = Record<string, string | number>

export interface I18n<L extends string, D extends Dictionary> {
  readonly locales: readonly L[]
  readonly defaultLocale: L
  readonly storageKey: string
  /** Lookup without React (server code, tests). Falls back to the default locale, then the key. */
  translate(locale: L, key: DictionaryKey<D>, params?: TranslateParams): string
}

export interface I18nContextValue<L extends string = string, K extends string = string> {
  readonly locale: L
  readonly locales: readonly L[]
  setLocale(locale: L): void
  t(key: K, params?: TranslateParams): string
}

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  )
}

/**
 * Pick a supported locale: the stored preference first, then each browser language (exact tag, then
 * its primary subtag), then `fallback`.
 */
export function negotiateLocale<L extends string>(
  stored: string | null | undefined,
  browser: readonly string[],
  supported: readonly L[],
  fallback: L,
): L {
  const find = (tag: string): L | undefined => {
    const lower = tag.toLowerCase()
    return (
      supported.find((s) => s.toLowerCase() === lower) ??
      supported.find((s) => s.toLowerCase() === lower.split('-')[0])
    )
  }
  if (stored) {
    const hit = find(stored)
    if (hit) return hit
  }
  for (const tag of browser) {
    const hit = find(tag)
    if (hit) return hit
  }
  return fallback
}

export function defineI18n<T extends Record<string, Dictionary>, DL extends keyof T & string>(
  config: I18nConfig<T, DL>,
): I18n<keyof T & string, T[DL]> {
  const dictionaries = config.dictionaries as Record<string, Dictionary>
  const locales = Object.keys(dictionaries)
  const translate = (locale: string, key: string, params?: TranslateParams): string => {
    const found =
      lookup(dictionaries[locale], key) ?? lookup(dictionaries[config.defaultLocale], key)
    return interpolate(found ?? key, params)
  }
  return {
    locales,
    defaultLocale: config.defaultLocale,
    storageKey: config.storageKey ?? 'theokit.locale',
    translate,
  }
}

const I18nContext = createContext<I18nContextValue | null>(null)

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language]
}

function readStored(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}

export interface I18nProviderProps<L extends string> {
  readonly i18n: Pick<I18n<L, Dictionary>, 'locales' | 'defaultLocale' | 'storageKey'> & {
    translate(locale: L, key: never, params?: TranslateParams): string
  }
  /** Force a locale (SSR, tests); skips negotiation. */
  readonly locale?: L
  readonly children?: ReactNode
}

export function I18nProvider<L extends string>(props: I18nProviderProps<L>): ReactElement {
  const { i18n, children } = props
  const [locale, setLocaleState] = useState<L>(() =>
    props.locale && i18n.locales.includes(props.locale)
      ? props.locale
      : negotiateLocale(
          readStored(i18n.storageKey),
          browserLanguages(),
          i18n.locales,
          i18n.defaultLocale,
        ),
  )
  const setLocale = useCallback(
    (next: L) => {
      setLocaleState(next)
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(i18n.storageKey, next)
      } catch {
        /* storage unavailable: the choice lasts for this session only */
      }
    },
    [i18n.storageKey],
  )
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      locales: i18n.locales,
      setLocale: setLocale,
      t: (key, params) =>
        (i18n.translate as (l: L, k: string, p?: TranslateParams) => string)(locale, key, params),
    }),
    [locale, i18n, setLocale],
  )
  return createElement(I18nContext.Provider, { value }, children)
}

/** The active locale, `setLocale`, and `t`. Throws outside an `I18nProvider`. */
export function useI18n<L extends string = string, K extends string = string>(): I18nContextValue<
  L,
  K
> {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n() must be called inside an <I18nProvider>')
  return ctx as unknown as I18nContextValue<L, K>
}

export function formatDate(
  locale: string,
  value: Date | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(value)
}

export function formatNumber(
  locale: string,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value)
}

/** "3 minutes ago" / "in 2 days": picks the largest fitting unit from the distance to `now`. */
export function formatRelativeTime(
  locale: string,
  value: Date | number,
  now: Date | number = Date.now(),
): string {
  const diff = (new Date(value).getTime() - new Date(now).getTime()) / 1000
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, secs] of units) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit)
  }
  return rtf.format(Math.round(diff), 'second')
}
