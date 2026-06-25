# BidKing 藏品数据提取流程

## 文档定位

- 本文件是当前 `Archive/BidKing` 游戏本体提取 `collectibles.json` 的 authoritative 流程。
- 它覆盖旧的“直接读取 `StreamingAssets/Tables/*.txt`”假设。最新版游戏的权威表已经打进 YooAsset tables bundle，不能再靠旧路径直接取。
- 最终产物固定为：
  - 仓库根 `collectibles.json`
  - `public/data/collectibles.json`

## 2026-06-25 已验证事实

- 藏品表位于逻辑 bundle：`defaultpackage_assets_game_bundle_tables.bundle`
- 对应的当前构建哈希 bundle 是：
  - `Archive/BidKing/BidKing_Data/StreamingAssets/yoo/DefaultPackage/37c68f86fd7f3059ee759da9cbb14777.bundle`
- 该 bundle 不是明文 `UnityFS`，而是 `AES-256-CBC` 加密后的二进制。
- 当前构建实测密钥参数来自：
  - `$db.$Cs()` -> `Aa123lktest0lnmd64567890Cc010086`
  - `$db.$fs()` -> `lnmd6lktest0Bb12`
- 解密后的 bundle 内含两个关键 `TextAsset`：
  - `Item`
  - `Item_Type`
- 当前版本导出的 `Item.txt` / `Item_Type.txt` 是原始 `TSV`，不是旧版的 base64 包裹文本。
- `scripts/extract-bidking-collectibles.js` 已兼容：
  - 旧版 base64 表
  - 当前 raw TSV 表

## 前置条件

- 游戏本体位于 `Archive/BidKing`
- Node.js 可用
- Windows + WSL 可用
- `tmp/unitypy-venv` 可用，且其中装有 `UnityPy`
- 当 key / iv 失效时，需要保持 agent 注入状态以重新调用 `$db.$Cs()` / `$db.$fs()`

## 步骤 1：定位 tables bundle

先取当前 `DefaultPackage` 的最新 catalog bytes，再确认 `Item` / `Item_Type` 属于哪个逻辑 bundle：

```powershell
bash -lc "CATALOG=\$(ls -t /mnt/a/BidKing/Archive/BidKing/BidKing_Data/StreamingAssets/yoo/DefaultPackage/DefaultPackage_*.bytes | head -n 1); strings \"\$CATALOG\" | grep -n -C 2 -E 'Assets/Game/Bundle/Tables/Item|defaultpackage_assets_game_bundle_tables.bundle|Item_Type'"
```

当前已验证输出会同时出现：

- `Assets/Game/Bundle/Tables/Item.txt`
- `Assets/Game/Bundle/Tables/Item_Type.txt`
- `defaultpackage_assets_game_bundle_tables.bundle`

然后在 `BuildinCatalog.json` 中确认真实哈希文件名：

```powershell
rg -n "37c68f86fd7f3059ee759da9cbb14777" Archive/BidKing/BidKing_Data/StreamingAssets/yoo/DefaultPackage/BuildinCatalog.json
```

当前映射结果是：

- `BundleGUID`: `37c68f86fd7f3059ee759da9cbb14777`
- `FileName`: `37c68f86fd7f3059ee759da9cbb14777.bundle`

注意：

- `DefaultPackage_*.bytes` 里逻辑 bundle 名旁边的 hash 字符串可能带尾部噪声字符。
- 最终以 `BuildinCatalog.json` 中存在的 `32` 位 `BundleGUID` / `FileName` 为准。

## 步骤 2：确认 AES 参数

### 当前构建可直接使用的参数

- key: `Aa123lktest0lnmd64567890Cc010086`
- iv: `lnmd6lktest0Bb12`
- algorithm: `aes-256-cbc`

### 当参数变化时的回收方式

先保持 agent 注入，再通过 `bkcli` 读取游戏内静态方法：

```powershell
node tools/bkcli/bkcli.js ping
node tools/bkcli/bkcli.js run InvokeSingletonMethod '{"className":"$db","methodName":"$Cs"}'
node tools/bkcli/bkcli.js run InvokeSingletonMethod '{"className":"$db","methodName":"$fs"}'
```

这两个值来自 `AES256Decryption.ReadFileData` 最终调用链。静态逆向依据保留在：

- `tmp/il2cppdumper-out/dump.cs`
- `tmp/il2cppdumper-out/script.json`

## 步骤 3：离线解密 tables bundle

不要再走旧的“把运行时二进制按 UTF-8 文本写出”的 dump 路线；那会把 bundle 写坏。权威路径是直接对磁盘上的原始加密 bundle 做离线解密。

```powershell
node -e "const fs=require('fs'); const crypto=require('crypto'); const bundleId='37c68f86fd7f3059ee759da9cbb14777'; const inPath='A:/BidKing/Archive/BidKing/BidKing_Data/StreamingAssets/yoo/DefaultPackage/' + bundleId + '.bundle'; const outPath='A:/BidKing/tmp/collectibles-extract/' + bundleId + '.decrypted.bundle'; const key=Buffer.from('Aa123lktest0lnmd64567890Cc010086','utf8'); const iv=Buffer.from('lnmd6lktest0Bb12','utf8'); const data=fs.readFileSync(inPath); const d=crypto.createDecipheriv('aes-256-cbc', key, iv); const out=Buffer.concat([d.update(data), d.final()]); fs.writeFileSync(outPath, out); console.log(JSON.stringify({ outPath, size: out.length, head: out.subarray(0, 16).toString('hex') }, null, 2));"
```

其中 `bundleId` 要替换为步骤 1 里定位出的当前 tables bundle 哈希；对 `2026-06-25` 这个构建，值是 `37c68f86fd7f3059ee759da9cbb14777`。

验证点：

- 解密后文件头应以 `UnityFS` 开头
- 当前实测输出头部是 `556e69747946530000000008352e782e`

## 步骤 4：从解密 bundle 导出 `Item` / `Item_Type`

```powershell
bash -lc "/mnt/a/BidKing/tmp/unitypy-venv/bin/python - <<'PY'
import UnityPy
from pathlib import Path

bundle = '/mnt/a/BidKing/tmp/collectibles-extract/37c68f86fd7f3059ee759da9cbb14777.decrypted.bundle'
out_dir = Path('/mnt/a/BidKing/tmp/collectibles-extract/tables')
out_dir.mkdir(parents=True, exist_ok=True)

env = UnityPy.load(bundle)
for obj in env.objects:
    if obj.type.name != 'TextAsset':
        continue
    data = obj.read()
    if data.m_Name not in {'Item', 'Item_Type'}:
        continue
    text = data.m_Script if isinstance(data.m_Script, str) else data.m_Script.decode('utf-8')
    (out_dir / f'{data.m_Name}.txt').write_text(text, encoding='utf-8')
    print(f'WROTE\\t{data.m_Name}\\t{len(text)}')
PY"
```

当前实测结果：

- `Item_Type.txt` 长度 `1337`
- `Item.txt` 长度 `430165`

## 步骤 5：生成并覆盖仓库藏品 JSON

```powershell
node scripts/extract-bidking-collectibles.js tmp/collectibles-extract/tables
```

该命令会直接覆盖：

- `collectibles.json`
- `public/data/collectibles.json`

当前版本（2026-06-25）实测：

- 藏品总数：`619`
- 相比旧仓库数据：新增 `27` 个条目
- 旧条目字段无变更

## 步骤 6：验证

最低验证链：

```powershell
npx vitest run scripts/extract-bidking-collectibles.test.mjs
node -e "const fs=require('fs'); const a=fs.readFileSync('collectibles.json','utf8'); const b=fs.readFileSync('public/data/collectibles.json','utf8'); const items=JSON.parse(a); console.log(JSON.stringify({same:a===b,count:items.length}, null, 2));"
```

当前已验证结果：

- `scripts/extract-bidking-collectibles.test.mjs`：`6/6` 通过
- 两份 JSON 完全一致
- 输出总数 `619`

## 常见误区

### 1. 直接读取 `StreamingAssets/Tables`

这只适用于旧版本。最新版游戏的权威表已经封进 YooAsset tables bundle；如果继续走旧路径，会拿不到当前版本真实数据。

### 2. `Item.txt` 和 `Item_Type.txt` 文件一样大，甚至都以 `UnityFS` 开头

这不是表，而是把同一个 bundle 错当成文本写出了两次。需要回到“离线解密 bundle -> 导出 TextAsset”的流程。

### 3. `extractCollectibles()` 报 `Expected 10 collectible types, found 0`

通常说明：

- 你喂给脚本的不是 `Item_Type` 文本表
- 或者导出结果仍是损坏 bundle
- 或者表目录指错了

先确认 `tmp/collectibles-extract/tables/Item_Type.txt` 的前几行是 `TSV` 文本，而不是 `UnityFS` 头。

### 4. key / iv 失效

如果新版本变更了加密参数：

- 保持 agent 注入
- 重新调用 `$db.$Cs()` / `$db.$fs()`
- 必要时回看 `tmp/il2cppdumper-out/dump.cs` 中的 `AES256Decryption.ReadFileData`

## 当前推荐工作目录

- 原始加密 bundle：`Archive/BidKing/BidKing_Data/StreamingAssets/yoo/DefaultPackage/`
- 中间产物：`tmp/collectibles-extract/`
- 最终表目录：`tmp/collectibles-extract/tables/`
- 最终 JSON：
  - `collectibles.json`
  - `public/data/collectibles.json`
