import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vitejs.dev/config/
export default defineConfig({
    base: './',
    plugins: [
        vue(),
        nodePolyfills({
            // simple-peer 依赖 buffer 和 util
            include: ['buffer', 'util'],
            globals: {
                Buffer: true,
            },
            protocolImports: true,
        }),
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        }
    },
    // 如果需要部署到子目录，例如 https://ppmc.club/webchat/
    // base: '/webchat/',
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
        // 增加 chunk 大小警告限制，因为 virtual-scroller 可能较大
        chunkSizeWarningLimit: 1000,
        terserOptions: {
            compress: {
                // 生产环境时移除 console
                drop_console: true,
                drop_debugger: true,
            },
        },
    },
    server: {
        port: 5173,
        // 开发时代理API请求以解决CORS问题
        // proxy: {
        //   '/api': {
        //     target: 'https://ppmc.club/webchat',
        //     changeOrigin: true,
        //     rewrite: (path) => path.replace(/^\/api/, '')
        //   }
        // }
    }
})