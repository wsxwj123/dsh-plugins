// HTTP 测试驱动：起一个真实 loopback 服务，用 node 内置 http 收发，验证传输层契约。
// 不引外部框架。
//
// 使用方式：
//   const { start, request, stop } = await createHttpHarness(handler)
//   const res = await request({ path: '/ct/instructions.list', method: 'POST', body: {...} })
//   res.status / res.headers / res.json (解析后的 JSON) / res.text (原始 body)
//
// handler = (req, res) => void   —— 由测试注入，即插件 host 半的 HTTP 路由处理。
// 见各 host-rpc-*.test.mjs 顶部的 seam 说明。

import { createServer, request as nodeRequest } from 'node:http'
import { once } from 'node:events'

/**
 * 组装针对一个已经 listen 的 server 的请求。
 * opts: { method, path, headers, body }
 * body 为对象时序列化 JSON；undefined 不写 body。
 * 返回 { status, headers, text, json }
 */
export function httpClient(port, opts) {
  const { method = 'POST', path = '/', headers = {}, body } = opts
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = nodeRequest(
      { hostname: '127.0.0.1', port, method, path, headers: { ...headers }, agent: false },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = text ? JSON.parse(text) : null
          } catch {
            json = null
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json })
        })
      },
    )
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

/**
 * 起测试服务并返回驱动工具。
 * handler = (req, res) => void
 */
export async function createHttpHarness(handler) {
  const server = createServer((req, res) => {
    try {
      handler(req, res)
    } catch (err) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: false, code: 'system-error', message: String(err) }))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  return {
    port,
    /** 发请求 */
    request: (opts) => httpClient(port, opts),
    /** 关闭服务 */
    async stop() {
      server.close()
      // 兜底：若有残留长连接，强制断开，确保 close 事件一定触发
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      await once(server, 'close')
    },
  }
}
