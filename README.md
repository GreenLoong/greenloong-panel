# 绿龙面板

面向 Windows 的 Minecraft Java 服务端部署与管理工具。使用公网 IPv6 和 DDNS 绑定自有域名，可通过 MCSManager 管理模组服，无需内网穿透或 VPN。

## 使用

从本仓库 Releases 下载完整部署包，解压到固定目录后双击 `Launch.cmd`。填写自己的游戏子域名、端口和 DNS 凭据；没有预设账号、域名或密钥。

- 分析 ZIP／MRPACK，识别客户端／服务端及已有核心。
- 按版本保留或准备 Forge、Fabric、NeoForge 等服务端。
- 导入现有服务器，复制原核心、模组、插件、配置和存档。
- 一键启动、正常停服与本机 MCSManager 登录。
- 显示下载大小、速度、重试和超时；支持停止、重新下载、结束任务。
- 检测旧平台端口、旧 DDNS 服务和域名解析冲突。
- GitHub API 受限时优先使用缓存或官方发布页面。

两台电脑同时开服时使用不同子域名，例如 `mc1.example.com`、`mc2.example.com`；同一电脑的多个游戏端口可以共用一个域名。朋友需要可用的 IPv6 和兼容的客户端整合包。

详细操作、版本兼容和限制见 [使用说明](使用说明.md)。

## 源码开发

需要 Windows、Node.js 22 或更高版本。项目只使用 Node 内置模块，不需要安装 npm 依赖。

```powershell
node --test tests/*.test.mjs
node server.mjs
```

完整部署包附带 Node 运行时。源码仓库不提交运行时二进制；如需使用 CMD 启动入口或打包，按 [runtime/README.md](runtime/README.md) 准备运行时。

## 本机数据与发布

`data/` 包含服务器、存档、上传文件、下载缓存和本机凭据，已加入 `.gitignore`，不属于发布源码。构建脚本按允许名单打包，不包含上述数据。DNS 密钥在本机受限目录保存，记住的 MCSManager 密码使用 Windows 当前账户加密。

升级时先退出旧控制后台，保留自己的 `data/` 目录。不要将运行后的整个目录直接公开上传。

MCSManager、ddns-go、Node.js 和各服务端组件由其各自项目维护，相关第三方许可应随组件保留。
