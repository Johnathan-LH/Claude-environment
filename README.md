# Claude environment

我的 Claude Code mods。

## token-meter

顯示每個 Claude Code task 在目前 **5 小時** 與 **一週** 額度窗口內消耗的 token，以及帳號整體額度百分比。

- 狀態列：目前 task 的 5h／週 token 與估計 %
- `/token-meter`：面板列出所有 task（同一台電腦），附完整表格

限制：claude.ai 一般 chat 無法逐一統計（mod 只在 Claude Code 執行），但帳號整體 % 已含 chat 的用量；「≈%」是 task 執行期間帳號 % 的增量，屬估計值。

### 安裝

在 Claude Code 終端機輸入：

```
/plugin install token-meter --marketplace Johnathan-LH/claude-environment
```

出現 `Add marketplace?` 時按 `y`，再選 user scope。
