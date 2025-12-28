# 使用 Node.js 20 Alpine 作为基础镜像
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制源代码
COPY . .

# 新增这两行，接收构建参数
ARG BACKEND_URL
ENV BACKEND_URL=$BACKEND_URL

# 构建 Next.js 应用
RUN npm run build

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["npm", "run", "start"]
