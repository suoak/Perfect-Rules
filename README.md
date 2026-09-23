# Suchen Rules

这是一套仅针对当前个人订阅设计的分流配置。

## 节点结构

配置会把订阅节点按名称自动划分为四个地区：

- 美国：`US001` 至 `US006`
- 日本：`JP001` 至 `JP003`
- 新加坡：`SG001`
- 韩国：`KOR01`

订阅更新后，配置可识别中英文地区名、国旗以及 `US/USA`、`JP/JPN`、`SG/SGP`、`KR/KOR` 等常见前缀，并自动进入对应地区组。

## 路由策略

规则按以下顺序匹配：

1. 公司内网、私有地址、`ruijie.com.cn`、飞书和 Lark 直连。
2. ChatGPT、Codex、Claude、Gemini 及其他国外 AI 走 `🤖 国外 AI`。
3. 中国大陆域名和 IP 直连。
4. 其余流量全部走 `🚀 代理选择`。

AI 策略组不提供 `DIRECT`，避免国外 AI 意外直连。

## 飞连兼容

- 节点测速使用 Cloudflare 的 `generate_204`，不依赖可能被内网拦截的 Google 域名。
- 测速每 600 秒按需执行，并严格校验 HTTP `204`，避免企业拦截页被误判为可用节点。
- DNS 仅监听 `127.0.0.1:1053`，不向局域网暴露解析服务。
- Mihomo 不接管私网、运营商级 NAT、回环和链路本地网段，这些流量由系统路由或飞连处理。
- TUN 关闭严格路由，减少 Windows 防火墙规则与飞连虚拟网卡、企业 DNS 冲突的概率。
- 内网、Apple 推送及系统连通性检测域名绕过 Fake-IP；内网域名不参与强制嗅探改写。
- TCP keep-alive 保持为 30 秒，兼顾 Codex、ChatGPT 和飞书的长连接。
- 建议先连接飞连，再启动 Clash；飞连优先使用极速模式。

## 使用方式

### Clash Mi

把 [`Clash/Clash_mi.js`](./Clash/Clash_mi.js) 作为当前订阅的 JS 覆写，并选择“内置-覆写”。脚本直接读取订阅中的节点，不保存订阅地址或凭据。

### Clash Verge / Mihomo

把 [`Clash/Clash_merge.yaml`](./Clash/Clash_merge.yaml) 作为当前订阅的全局扩展覆写。地区组通过节点名称过滤，因此订阅更新后无需重新生成配置。

### V2rayN

导入 [`V2rayN.json`](./V2rayN.json) 作为路由规则集。
