FROM node:20-slim

WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制源代码
COPY . .

# 编译 TypeScript（可选）
RUN npx tsc

# 暴露端口（如果需要）
EXPOSE 3000

# 启动命令
CMD ["npx", "ts-node", "index.ts"]