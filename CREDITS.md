# 素材來源與授權

本專案是一個非商業的個人／教學用途小工具。以下列出所有使用到的第三方素材，
以及各自的授權條件。使用前請自行前往原始頁面確認最新的授權內容。

---

## 貓咪角色動畫

- **素材包**：Animated Pixel Kittens / Cats 32x32
- **作者**：Last tick
- **來源**：https://last-tick.itch.io/animated-pixel-kittens-cats-32x32
- **授權**：可用於個人與商業專案（Use in personal and commercial projects is allowed）
- **本專案使用的檔案**：
  - `assets/Free pack/` — 三種基底毛色（`cat 1.png`、`cat 1.6.png`、`cat 1.9.png`）
  - `assets/14 feb/` — 11 種配件圖層（蝴蝶結、愛心眼鏡、翅膀等）
  - `assets/Winter accessories/` — 4 種配件圖層（聖誕帽、馴鹿角）

> 技術備註：檔名寫 16x16 指的是貓的畫面大小，實際的 frame cell 是 32x32，
> 圖檔為 352x1696（11 欄 × 53 列）。配件資料夾內只有配件本身，
> 必須疊在基底毛色上繪製。

## 地圖與場景美術

- **素材包**：Pixel Art Top Down - Basic（v1.2.3）
- **作者**：Cainos
- **來源**：https://cainos.itch.io/pixel-art-top-down-basic
- **文件**：https://docs.cainos.net/pixel-art-top-down-basic
- **授權**：可用於免費與商業專案（This asset pack can be used in both free and commercial projects）
- **本專案使用的檔案**（皆位於 `assets/Pixel Art Top Down - Basic v1.2.3/Texture/`）：
  `TX Tileset Grass.png`、`TX Tileset Stone Ground.png`、`TX Tileset Wall.png`、
  `TX Struct.png`、`TX Props.png`、`TX Plant.png`、`TX Shadow Plant.png`

## 介面配色（僅致謝，未包含任何檔案）

- **素材包**：Sprout Lands - UI Pack
- **作者**：Cup Nooble
- **來源**：https://cupnooble.itch.io/sprout-lands-asset-pack

介面的米白／棕色系配色是參考這個素材包的色調決定的，`css/` 裡只有十六進位色碼。

> **本專案沒有、也不會包含這個素材包的任何檔案。**
> 該素材包的授權明確禁止轉散布（resold/redistributed, even if modified），
> 因此它不在版本控制中，也已從 Git 歷史裡移除。
> 如果你想取得該素材包，請直接前往上方連結向作者取得。

---

## 關於 `assets/` 資料夾

版本控制中只保留程式實際會載入的 25 個圖檔。原始素材包裡的
`.aseprite` 原始檔、調色盤、Unity package、示範圖與未使用的圖塊都已移除，
以縮小 repo 並避免不必要的再散布。

需要完整素材包請向上述各作者取得。
