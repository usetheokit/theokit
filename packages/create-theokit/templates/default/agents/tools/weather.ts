import { tool } from 'theokit/server'
import { z } from 'zod'

/**
 * An example agent tool — current weather for a place, via the keyless open-meteo API.
 *
 * A tool is PURE metadata + a handler: it describes a capability and runs local/HTTP work; it NEVER calls
 * an LLM (the agent decides when to invoke it). Lives in `tools/` — a semantic sub-folder the agent
 * scanner skips — and is imported into `chat.ts` and chained with `.tool(weatherTool)`.
 *
 * Add your own the same way: `tool('name').describe(...).input(z.object({...})).execute(async (input) => …).build()`.
 */

interface GeocodeResult {
  results?: Array<{ name: string; latitude: number; longitude: number; country?: string }>
}

interface ForecastResult {
  current?: { temperature_2m?: number; wind_speed_10m?: number; weather_code?: number }
}

const WEATHER_TEXT: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'foggy',
  51: 'light drizzle',
  61: 'rain',
  71: 'snow',
  80: 'rain showers',
  95: 'thunderstorm',
}

export const weatherTool = tool('weather')
  .describe('Get the current weather for a city or place name.')
  .input(z.object({ location: z.string().describe('City or place, e.g. "Lisbon" or "Tokyo"') }))
  .execute(async ({ location }) => {
    const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search')
    geoUrl.searchParams.set('name', location)
    geoUrl.searchParams.set('count', '1')
    const geoRes = await fetch(geoUrl)
    if (!geoRes.ok) throw new Error(`Geocoding failed for "${location}" (${geoRes.status})`)
    const place = ((await geoRes.json()) as GeocodeResult).results?.[0]
    if (!place) throw new Error(`Could not find a place called "${location}".`)

    const wxUrl = new URL('https://api.open-meteo.com/v1/forecast')
    wxUrl.searchParams.set('latitude', String(place.latitude))
    wxUrl.searchParams.set('longitude', String(place.longitude))
    wxUrl.searchParams.set('current', 'temperature_2m,wind_speed_10m,weather_code')
    const wxRes = await fetch(wxUrl)
    if (!wxRes.ok) throw new Error(`Weather lookup failed for "${location}" (${wxRes.status})`)
    const now = ((await wxRes.json()) as ForecastResult).current
    if (!now) throw new Error(`No current weather available for "${location}".`)

    const condition = WEATHER_TEXT[now.weather_code ?? 0] ?? 'unknown conditions'
    const where = place.country ? `${place.name}, ${place.country}` : place.name
    return `Weather in ${where}: ${condition}, ${now.temperature_2m}°C, wind ${now.wind_speed_10m} km/h.`
  })
  .build()
