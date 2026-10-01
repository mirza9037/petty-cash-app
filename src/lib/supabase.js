import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
let validUrl = false
try {
  validUrl = ['http:', 'https:'].includes(new URL(url).protocol)
} catch {
  /* Report configuration errors before rendering routes. */
}
export const configurationError =
  !validUrl || !key
    ? 'Supabase configuration is missing or invalid. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild the app.'
    : ''
export const supabase = configurationError
  ? null
  : createClient(url, key, {
      global: {
        fetch: (input, options = {}) =>
          fetch(input, {
            ...options,
            signal: options.signal
              ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
              : AbortSignal.timeout(20000),
          }),
      },
    })
