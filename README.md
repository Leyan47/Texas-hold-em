# 單人德州撲克

這是一個純前端的單人 Texas Hold'em 遊戲。玩家在瀏覽器中對戰一位 equity 型策略 AI，所有牌局、下注、AI 決策與勝負判斷都在本機 JavaScript 執行。

## 啟動方式

建議用本機靜態伺服器開啟，避免瀏覽器限制 ES Module 載入：

```bash
python -m http.server 8000
```

若環境沒有 Python，也可以用 Node.js：

```bash
node -e "const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const root=process.cwd();const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};http.createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');const name=url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname);const file=path.normalize(path.join(root,name));if(!file.startsWith(root)){res.writeHead(403);res.end('forbidden');return;}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('not found');return;}res.writeHead(200,{'content-type':types[path.extname(file)]||'text/plain; charset=utf-8'});res.end(data);});}).listen(8000,'127.0.0.1',()=>console.log('http://127.0.0.1:8000'));"
```

然後開啟：

```text
http://localhost:8000
```

如果你的瀏覽器允許直接載入本機 ES Module，也可以直接開啟 `index.html`。

## 已實作功能

- 玩家與 AI 各 1000 籌碼起始。
- 每局玩家支付小盲 10，AI 支付大盲 20。
- 依序支援 Preflop、Flop、Turn、River、Showdown。
- 玩家可 Check、Call、Bet、Raise、Fold。
- Bet / Raise 金額可輸入，並會限制不超過玩家籌碼。
- AI 會用 Monte Carlo 模擬估算 equity，並根據階段、跟注金額、底池大小與隨機性決策。
- 面對下注時，AI 會參考 pot odds 與 MDF，避免只用「目前牌型強弱」決定跟注或棄牌。
- AI 下注策略偏向 polarized：強牌 value bet / raise，聽牌與 blocker 牌可 semi-bluff / bluff，中等牌較常 check / call。
- 支援 all-in 簡化處理，並會退還單挑中未被跟注的籌碼。
- River 後會攤牌，AI 手牌在攤牌前保持蓋牌。
- 多局遊玩時籌碼會累積或扣除，任一方籌碼歸零後下一局會重置為 1000。

## 檔案結構

- `index.html`：遊戲畫面與控制按鈕。
- `style.css`：桌面、卡牌、籌碼資訊與響應式樣式。
- `main.js`：遊戲狀態、下注流程、UI 更新、攤牌與底池分配。
- `poker.js`：牌組、洗牌、發牌、7 選 5 最佳牌型、勝負比較。
- `ai.js`：Monte Carlo equity、pot odds、MDF、draw / blocker 評分與 AI 行動決策。
- `tests/poker.test.mjs`：牌型判斷的輕量自動測試。
- `tests/ai.test.mjs`：AI all-in、防加注、value-bet 與 pot-odds call 策略測試。

## AI 策略

`ai.js` 目前不是完整 GTO solver，但已比單純規則型 AI 更接近 solver 思維：

- Preflop 使用起手牌啟發式評分。
- Flop / Turn / River 使用 Monte Carlo 模擬，估算 AI 手牌對隨機對手手牌與未發公共牌的勝率。
- 面對下注時使用 `potOdds = toCall / (pot + toCall)` 判斷跟注門檻。
- 使用 `MDF = pot / (pot + bet)` 提高最低防守頻率，減少被過度 bluff 剝削。
- 使用 draw score 與 blocker score 讓聽牌、A / K blocker 有機會成為 semi-bluff 或 bluff。
- 每個 AI 決策會保留 `equity` 與 `reason`，方便未來除錯或顯示更詳細的 AI 行為。

## 牌型支援

由大到小支援：

1. Royal Flush
2. Straight Flush
3. Four of a Kind
4. Full House
5. Flush
6. Straight
7. Three of a Kind
8. Two Pair
9. One Pair
10. High Card

`poker.js` 會從 7 張牌中列舉所有 5 張組合，選出最佳牌型。A 可作為最大牌，也可在 A-2-3-4-5 順子中作為 1。同牌型會繼續比較 kicker。

## 自動測試

需要 Node.js。執行：

```bash
node --experimental-default-type=module tests/poker.test.mjs
node --experimental-default-type=module tests/ai.test.mjs
```

測試涵蓋：

- 52 張不重複牌組。
- Royal Flush 判斷。
- A-2-3-4-5 wheel straight。
- 兩組 trips 時選出最佳 Full House。
- One Pair 同牌型時比較 kicker。
- 玩家已 All-in 時，AI 不會再加注造成流程卡住。
- 強牌 checked-to 時，AI 會回傳 value-bet 策略理由與 equity。
- 面對下注且不能再加注時，AI 會回傳 pot-odds-call 策略理由與 equity。

## 人工測試情境

1. 點 New Hand 後按 Fold，確認 AI 直接獲勝且獲得底池。
2. 多玩幾局，遇到 AI 棄牌時確認玩家直接獲勝且獲得底池。
3. 持續 Check / Call 到 River，確認會攤牌並比較牌型。
4. 在攤牌訊息中觀察相同牌型時 kicker 較大的玩家獲勝。
5. 將某方籌碼玩到很低，確認下注不會超過剩餘籌碼，all-in 後會自動攤牌。
6. 連續點 New Hand 遊玩多局，確認玩家與 AI 籌碼會正確累積或扣除。
