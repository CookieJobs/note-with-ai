# NoteWithAI 部署与更新指南

本文档包含将代码更新到服务器以及在服务器上进行操作的详细步骤。

## 📋 目录
1. [代码更新流程](#1-代码更新流程)
2. [服务器操作指南](#2-服务器操作指南)
3. [Nginx 配置修复特别指南](#3-nginx-配置修复特别指南)

---

## 1. 代码更新流程

在本地电脑上完成代码修改后，需要将其推送到代码仓库，然后在服务器上拉取。

### 第一步：提交代码 (本地)
打开终端，在项目根目录下执行：

```bash
# 1. 添加所有修改
git add .

# 2. 提交修改 (写一个有意义的备注)
git commit -m "修复 Nginx 配置问题"

# 3. 推送到远程仓库 (例如 GitHub/GitLab)
git push
```

### 第二步：登录服务器
使用 SSH 登录你的远程服务器：

```bash
# 请将 your_server_ip 替换为你的服务器 IP (例如 47.118.16.95)
# 如果有特定的用户名 (如 root)，请使用 ssh root@your_server_ip
ssh root@47.118.16.95
```

### 第三步：拉取最新代码 (服务器)
登录成功后，进入你的项目目录并拉取代码：

```bash
# 1. 进入项目目录 (根据你的实际部署路径，可能是 /var/www/noteWithAI 或 ~/noteWithAI)
cd /path/to/your/project/noteWithAI

# 2. 拉取最新代码
git pull
```

### 第四步：重建服务 (如果修改了代码)
如果你修改了前端或后端的代码 (JS/TS 文件)，需要重建 Docker 容器：

```bash
# 停止并删除旧容器
docker-compose down

# 重新构建并启动 (后台运行)
docker-compose up -d --build
```
> **提示**: 如果只是修改 Nginx 配置，不需要执行这一步。

---

## 2. 服务器操作指南

以下是一些常用的服务器维护命令。

### 查看服务状态
```bash
# 查看所有容器运行状态
docker-compose ps

# 查看实时日志 (按 Ctrl+C 退出)
docker-compose logs -f
```

### 重启特定服务
```bash
# 只重启后端
docker-compose restart backend

# 只重启前端
docker-compose restart frontend
```

---

## 3. Nginx 配置修复特别指南

针对你当前遇到的 `404 Not Found` 问题，这是修复步骤。

### 第一步：找到 Nginx 配置文件
通常 Nginx 配置文件位于 `/etc/nginx/sites-enabled/` 目录下。

```bash
# 进入配置目录
cd /etc/nginx/sites-enabled/

# 列出文件，找到你的配置文件 (可能是 default 或 bloomy16.com)
ls
```

### 第二步：编辑配置文件
假设你的配置文件名为 `bloomy16.com` (如果没有，可能在 `default` 中)：

```bash
# 使用 nano 编辑器打开文件 (比 vim 更容易上手)
nano bloomy16.com
# 或者
nano default
```

### 第三步：修改内容
找到 `location /api/` 部分，参考 `deploy/nginx.conf.example` 进行修改。

**修改前 (错误)**:
```nginx
location /api/ {
    proxy_pass http://localhost:3001/;  # <--- 注意这个斜杠
}
```

**修改后 (正确)**:
```nginx
location /api/ {
    proxy_pass http://localhost:3001/api/; # <--- 明确加上 /api/
    # 其他配置保持不变...
}
```

### 第四步：保存并退出 (Nano 编辑器)
1. 按 `Ctrl + O` (保存)
2. 按 `Enter` (确认文件名)
3. 按 `Ctrl + X` (退出编辑器)

### 第五步：验证并重启 Nginx
在修改生效前，必须检查配置语法是否正确：

```bash
# 1. 检查语法
sudo nginx -t

# 如果显示 "syntax is ok" 和 "test is successful"，则继续。
# 如果报错，请重新检查配置文件。

# 2. 重启 Nginx 使配置生效
sudo systemctl reload nginx
```

🎉 **完成！** 现在再次访问网站尝试登录。
