// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  devServer: { port: 3401 },
  runtimeConfig: {
    tmaApiKey: process.env.TMA_API_KEY || '',
    tmaEnableFetch: process.env.TMA_ENABLE_FETCH === 'true'
  },
  modules: ['@nuxtjs/tailwindcss', '@nuxtjs/color-mode'],
  colorMode: {
    preference: 'system', // default value of $colorMode.preference
    fallback: 'light', // fallback value if not system preference found
    globalName: '__NUXT_COLOR_MODE__',
    componentName: 'ColorScheme',
    classPrefix: 'theme-',
    classSuffix: '',
    storageKey: 'nuxt-color-mode'
  },
  vite: {
    plugins: [
      {
        name: 'suppress-nuxt-assets-root-404',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = (req.url || '').split('?')[0]
            if (url === '/_nuxt/' || url === '/_nuxt') {
              res.statusCode = 204
              res.end('')
              return
            }
            next()
          })
        }
      }
    ]
  },
  app: {
    head: {
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap' }
      ]
    }
  },
  nitro: {
    preset: 'node-server'
  }
})
