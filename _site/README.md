# 下载页（pics.momoto520.com）

这个文件夹是图库网站的生成脚本，跟图片本身无关。Cloudflare Pages 盯着这个仓库，每次往 main 推送，它会自动重新生成网站，几分钟后上线。

- 往仓库里加图、加视频文件夹，照旧加就行，网站会自己更新。
- 文件夹名以 `待发布` 开头的**不会**出现在网站上，改成 `BV号-歌名` 以后才会出现。
- 每支视频的标题、发布日期、B站链接、“关于这些图”都是从那个文件夹的 `README.md` 里读的。
- 首屏那张图、那句台词、说明文字在 `site.json` 里改。

## 文件

| 文件 | 用途 |
|---|---|
| `build.mjs` | 生成脚本：复制原图、做缩略图和预览图、按页面用字裁剪字体、写出整站 |
| `site.json` | 标题、说明文字、首屏图和台词 |
| `src/style.css`、`src/app.js` | 样式和交互（看大图、多选、在浏览器里打包下载） |
| `fonts/` | Momoto Sans 全量字体和许可证（SIL OFL 1.1），生成时只取页面用到的字 |

## 本地预览

```sh
cd _site
npm ci
node build.mjs
cd dist && python3 -m http.server 8765
```

## Cloudflare Pages 设置

- 构建命令：`cd _site && npm ci && node build.mjs`
- 输出目录：`_site/dist`
- 环境变量：`NODE_VERSION=22`
