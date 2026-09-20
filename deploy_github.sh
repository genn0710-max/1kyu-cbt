#!/bin/bash
set -e

DIR="/Users/suzukikantoku/construction-report-app/cbt-web"
cd "$DIR"

echo "=========================================================="
echo "🚀 1級建築施工管理技士補 CBTアプリ GitHub Pages デプロイ"
echo "=========================================================="
echo ""
echo "リポジトリ: https://github.com/genn0710-max/1kyu-cbt"
echo ""

# リモートが未設定なら追加
if ! git remote | grep -q "origin"; then
  git remote add origin https://github.com/genn0710-max/1kyu-cbt.git
fi

echo "GitHubへプッシュを開始します..."
echo "※ GitHubのログイン画面またはPersonal Access Tokenの入力を求められたら入力してください。"
echo ""

git push -u origin main

echo ""
echo "=========================================================="
echo "🎉 GitHubへのアップロードが完了しました！"
echo ""
echo "【あと1ステップで永久URLが開通します】"
echo "1. ブラウザで以下を開いてください:"
echo "   https://github.com/genn0710-max/1kyu-cbt/settings/pages"
echo "2. Build and deployment の Branch を「main / (root)」にして [Save] をクリック"
echo ""
echo "👉 永久アクセスURL:"
echo "   https://genn0710-max.github.io/1kyu-cbt/"
echo "=========================================================="
