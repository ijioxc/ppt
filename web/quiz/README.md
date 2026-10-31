# 刷題本：新增科目

每個科目只有兩個地方要動，版面和功能全部共用。

1. 新增 `exams/<科目id>.js`（id 只能用小寫英文、數字和 `-`，例如 `electronics-midterm`）。
2. 在 `exams.json` 最前面加一筆，`id` 要一樣，`total` 填題數。

## 題庫檔格式

```js
const BANK = [
  // 觀念題
  {id:'1-1', set:1, n:1, topic:'二極體', short:'順向偏壓',
   q:'題目文字',
   o:['選項一','選項二','選項三','選項四'], a:1,   // a 是正解的位置，從 0 開始
   exp:'解釋',
   deep:'<p>觀念與陷阱，可寫 HTML</p><p class="trap">陷阱寫這裡</p>'},

  // 計算題：多一個 gen，對應下面 GEN 的名稱
  {id:'1-2', set:1, n:2, topic:'歐姆定律', short:'V = IR', gen:'ohm',
   q:'電阻 100 Ω 通過 2 A，電壓是多少？',
   o:['50 V','100 V','200 V','400 V'], a:2,
   exp:'V = IR = 2 × 100 = 200 V。', deep:'<p>…</p>'},
];

// 計算題換數字：沒有計算題可以寫 const GEN = {};
const GEN = {
  ohm:{
    orig:{R:100,I:2},                                  // 原題數字，用來顯示計算步驟
    rand:()=>({R:pick(50,500,50),I:pick(1,5)}),        // 隨機數字，pick(最小, 最大, 間隔)
    build:({R,I})=>{const V=R*I;return{
      q:`電阻 ${R} Ω 通過 ${I} A，電壓是多少？`,
      ans:V, unit:' V',
      wr:[V/2,V*2,R/I],                                // 錯誤答案，照常見錯法設計
      steps:[`V = I × R = ${I} × ${R}`,`V = ${fmt(V)} V`]}}},
};

QUIZ.register({
  id:'electronics-midterm',                            // 和檔名一樣
  title:'電子學期中考',
  eyebrow:'Electronics · HW1',
  sets:[{id:1,label:'作業一'}],                         // 題目的 set 對應這裡的 id
  bank:BANK, gen:GEN,
  formulas:[['V = IR','歐姆定律','作業一 2']],           // 公式、用途、出處，可省略
  unitNote:'單位提醒，可省略',
});
```

進度依科目 id 分開存，所以 id 定了就不要改，改了那科的進度會歸零。

## 其他題型

- **聽力**：題目加 `script:'對話原文'`、`scriptTitle:'標題'`，會出現朗讀按鈕。例子看 `exams/english-midterm.js`。
- **計算大題（先算再看解答）**：不寫 `o`、`a`，改寫 `html:'題目內容'`、`sol:'解答內容'`，可加 `no:'2.6.6'` 顯示原題號。例子看 `exams/fluid-workbook.js`。
