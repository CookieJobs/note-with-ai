# NoteWithAI 安全部署指南

此发布使用同机 Docker MongoDB（服务名 `mongo`）和 Redis；部署不会清空数据库或 Docker volume。管理员后台仅在 HTTPS 生效后使用，入口为 `https://bloomy16.com/admin`。

## 发布前

在服务器 `/root/note-with-ai/.env` 保留既有业务变量，并设置下列键。密钥只能保存在服务器 `.env`，不要提交、复制到终端记录或发送到聊天：

```dotenv
ALLOWED_ORIGINS=https://bloomy16.com
ADMIN_JWT_SECRET=<independent-random-secret>
ADMIN_JWT_EXPIRES_IN=8h
ADMIN_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
```

生成 `ADMIN_ENCRYPTION_KEY`：`openssl rand -base64 32`。`ADMIN_JWT_SECRET` 必须与普通 `JWT_SECRET` 不同。保留已有的 OpenRouter 和 embedding 变量，因为后台会读取无内容的聚合指标。

## 备份、构建和切换

先创建带时间戳的目录，备份当前提交、镜像、`.env`、`docker-compose.yml` 及 MongoDB archive。然后 `git fetch origin codex/admin-production-release`，校验 fetched commit，再以 detached HEAD 切换到该 commit；不要用 `git reset`，也不要覆盖服务器上已有的 Compose 变量。

切换后运行：

```bash
docker compose config
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3001/api/health
```

确认健康检查和容器状态后，再创建首位 owner。使用已编译的 CLI，而不是 `ts-node`：

```bash
docker compose exec -T \
  -e ADMIN_CREATE_EMAIL='<owner-email>' \
  -e ADMIN_CREATE_DISPLAY_NAME='<owner-display-name>' \
  -e ADMIN_CREATE_PASSWORD='<new-strong-password>' \
  -e ADMIN_CREATE_ROLE=owner \
  backend node dist/scripts/create_admin.js
```

该命令的 provisioning URI 仅在受控终端中显示；立即导入受信任的 TOTP 应用，安全交付密码，并避免在 shell history、日志或 Git 中保留两者。

## HTTPS

先安装 Nginx 和 Certbot。**证书文件尚不存在时，不要直接启用 `deploy/nginx.conf.example` 的 TLS server**；先保留当前可用 HTTP server，或仅配置下面的 HTTP bootstrap server，完成签发后再复制完整模板：

```nginx
server {
    listen 80;
    server_name bloomy16.com;
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { proxy_pass http://127.0.0.1:3000; }
}
```

```bash
mkdir -p /var/www/certbot
nginx -t && systemctl reload nginx
certbot certonly --webroot -w /var/www/certbot -d bloomy16.com \
  --email '<renewal-contact-email>' --agree-tos --non-interactive
cp deploy/nginx.conf.example /etc/nginx/sites-available/default
nginx -t && systemctl reload nginx
curl -I https://bloomy16.com/admin
```

确认 `certbot renew --dry-run` 成功，并检查系统定时续期服务。

## 回滚

停止前记录正在运行的镜像。若发布失败，恢复备份的 `.env` 和 Compose 文件，切换回备份 commit，使用原镜像或 `docker compose up -d --build` 恢复服务。数据库只在确认需要时才从 MongoDB archive 恢复；一般代码回滚不应恢复数据库。
