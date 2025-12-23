/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    eslint: {
      // Warning: This allows production builds to successfully complete even if
      // your project has ESLint errors.
      ignoreDuringBuilds: true,
    },
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
  