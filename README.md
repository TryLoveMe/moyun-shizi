# 墨韵识字 · 一字一画

中国风互动识字课件：**输入汉字，每个字都会化作一幅水墨画**，同时学习拼音、笔顺和书写。适合幼儿园、小学低年级识字课和亲子学习。

## 玩法

- **写字成画**：在“砚台”里输入汉字（支持拼音输入法），每个字展开成一幅卷轴水墨画，画上题有相关诗句和朱红印章。
  - 约 130 个常见字有专门的画（日月星云雨雪、山水石田、木林森竹梅荷、鸟鱼马牛羊、春夏秋冬……）。
  - “一”到“十”会画出对应数量的大雁，可以带孩子数一数。
  - “木 / 林 / 森”分别是一棵、两棵、三棵树，直观体会会意字。
  - 其他字会生成“字入山水”：字以飞白笔意写在山水之间。
- **学拼音**：拼音按声调着色（一声蓝、二声绿、三声橙、四声红），学字卡里拆出声母、韵母、声调，并提示多音字。
- **看笔顺 / 描一描**：田字格里播放笔顺动画（部首标红），也可以用手指或鼠标按笔顺描写，系统会判断对错。
- **读一读**：用浏览器自带的中文语音朗读单字、组词和诗句。
- **课堂模式**：全屏逐字展示，适合投屏上课。可以先隐藏拼音让孩子猜读音，再“揭晓拼音”。
  - 键盘：`←` `→` 翻页，`空格` 朗读，`P` 显示或隐藏拼音，`Esc` 退出。
- **预设课程**：天象、山水、草木、动物、数字、四季、古诗、儿歌，一键载入。
- **分享链接**：地址栏会自动记住当前的字，例如 `index.html?t=春夏秋冬`，老师可以把链接发给学生。

## 运行

纯静态网页，没有构建步骤：

```bash
# 直接双击 index.html 即可；或者起一个本地服务器：
python3 -m http.server 8000
# 然后访问 http://localhost:8000
```

也可以直接部署到 GitHub Pages、Gitee Pages 或任何静态服务器。

> 笔顺数据由 Hanzi Writer 从 jsDelivr CDN 按需加载，需要联网；断网时其他功能（作画、拼音、朗读）照常使用。

## 目录

```
index.html        页面
css/style.css     样式（宣纸、卷轴、田字格）
js/ink.js         水墨绘画引擎（程序化毛笔、晕染、皴法、各种画题）
js/lexicon.js     识字词库：字 → 画题、组词、诗句；预设课程
js/app.js         交互逻辑（输入、学字卡、课堂模式、朗读）
vendor/           pinyin-pro、hanzi-writer
fonts/            马善政毛笔楷书
```

### 添加新字

在 `js/lexicon.js` 里加一行即可，画题可以复用已有的画（如 `mountain`、`water`、`bird`、`plum` 等）：

```js
'峦': ['mountain', ['山峦', '峰峦'], '山峦起伏'],
```

## 致谢与许可

- [pinyin-pro](https://github.com/zh-lx/pinyin-pro)（MIT）：拼音
- [Hanzi Writer](https://hanziwriter.org/)（MIT），笔顺数据来自 [Make Me a Hanzi](https://github.com/skishore/makemeahanzi)（Arphic Public License）
- [Ma Shan Zheng 马善政毛笔楷书](https://fonts.google.com/specimen/Ma+Shan+Zheng)（SIL Open Font License，见 `fonts/OFL-MaShanZheng.txt`）
