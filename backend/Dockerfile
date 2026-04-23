# 使用 Node.js 20 Alpine 作为基础镜像
FROM node:20-alpine
RUN apk add --no-cache libc6-compat

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm config set registry https://registry.npmmirror.com
RUN npm install

# 复制源代码
COPY . .

# 构建 TypeScript 代码
RUN npm run build

# 暴露端口
EXPOSE 3001

# 启动命令
CMD ["npm", "run", "start"]
