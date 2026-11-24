# Windows 代码签名

`0.13.0` 及之前的所有发行包都是 **NotSigned**。这带来两个后果：用户从浏览器下载安装包时 Windows SmartScreen 会拦截一次；自动更新只校验 `latest.yml` 里的 sha512，不校验安装包的发布者签名。

代码签名需要一张由受信任 CA 签发的证书（OV 或 EV），这不是代码层面能绕过的。本文记录证书到位后如何接入，以及当前构建在无证书时的行为。

## 接入步骤

`electron-builder` 原生读取两个环境变量，不需要改配置：

| 变量 | 内容 |
| --- | --- |
| `CSC_LINK` | 证书文件路径，或 base64 编码的 `.pfx` 内容，或证书下载 URL |
| `CSC_KEY_PASSWORD` | 证书密码 |

设置后重新执行打包即可：

```powershell
$env:CSC_LINK = 'D:\certs\zhixing.pfx'
$env:CSC_KEY_PASSWORD = '<password>'
npm run electron:dist
npx electron-builder --win nsis --x64 --prepackaged release/win-unpacked --publish never
```

构建日志里出现 `signing with signtool.exe` 而不是 `skipped`，即表示已签名。验证：

```powershell
Get-AuthenticodeSignature release\ZhiXing-0.13.0-x64.exe | Format-List Status, SignerCertificate
```

`Status` 应为 `Valid`。

## 证书类型选择

- **OV**：便宜，签发后仍需积累 SmartScreen 声誉，早期下载可能仍被提示。
- **EV**：即时 SmartScreen 信任，但需要硬件令牌（HSM / USB），多数 CI 无法直接使用；云签名服务（Azure Trusted Signing 等）可以作为替代。

`electron-builder` 26 支持 `azureSignOptions`，如果将来改用云签名，在 `win` 段配置即可，同样不改代码。

## 当前行为

`electron-builder.yml` 里已移除强制跳过签名的 `signExecutable: false`。没有 `CSC_LINK` 时构建仍会成功，日志输出 `file signing skipped`，产物保持未签名——这是当前的默认状态。

## 未完成

- 证书尚未申请，因此**没有任何一次构建在签名状态下验证过**。
- 签名后应重新核对：`Get-AuthenticodeSignature` 状态、SmartScreen 首次下载表现、自动更新在签名版之间的升级。
- `verifyUpdateCodeSignature` 保持默认（`true`），意味着将来一旦开始签名，更新器会开始校验发布者；未签名的旧版本升级到已签名的新版本需要人工验证一次，避免因发布者变化被拒绝。
