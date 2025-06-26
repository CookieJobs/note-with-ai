/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    async rewrites() {
      console.log('🛠️ 代理规则加载中...');
      return [
        {
          source: '/api/:path*',
          destination: 'http://localhost:3001/api/:path*' // 将前端 /api 路由代理到后端服务
        },
      ];
    },
  };
  
  module.exports = nextConfig;
  