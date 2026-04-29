/*
Input: 环境变量 BACKEND_URL / NEXT_BUILD_WORKERS
Output: Next.js 构建、运行和 API 代理配置
Pos: 前端 Next.js 配置
Note: 生产 Docker 构建默认限制 worker 数量，避免低内存服务器在 next build 阶段卡死。
*/
/** @type {import('next').NextConfig} */
const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const buildWorkerCount = parsePositiveInteger(process.env.NEXT_BUILD_WORKERS, 1);

const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: true,
  },
  experimental: {
    cpus: buildWorkerCount,
  },
  output: 'standalone',
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    console.log(`🛠️ 代理规则加载中... 目标后端: ${backendUrl}`);
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`, // 将前端 /api 路由代理到后端服务
      },
    ];
  },
};

module.exports = nextConfig;
