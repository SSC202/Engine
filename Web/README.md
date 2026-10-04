# Engine Notes Web

这个目录是 `Note/` 电机驱动笔记的独立静态网站。构建过程只读取原始笔记，不会修改 `Note/` 中的任何文件。

## 本地预览

```powershell
cd Web
npm install
npm run dev
```

访问 <http://127.0.0.1:4173>。修改笔记或网页源码后，重新执行 `npm run build` 即可更新 `dist/`。

## 检查与部署

```powershell
npm run build
npm run check
```

`dist/` 是完整的静态站点，可部署到 GitHub Pages、Netlify、Cloudflare Pages 或任意静态文件服务器。PDF 资源使用仓库链接，不会在构建目录中重复复制。

仓库中的 `.github/workflows/deploy-web.yml` 会在 `V3.0` 分支相关内容更新后自动构建并部署 GitHub Pages，也可以从 Actions 页面手动触发。
