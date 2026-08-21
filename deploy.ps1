#!/usr/bin/env pwsh
# 一鍵部署豐澤分店清單至 GitHub Pages
# 用法: .\deploy.ps1 -Token ghp_xxx [-RepoName fortress-store-list] [-Private]
param(
    [Parameter(Mandatory = $true)]
    [string]$Token,
    [string]$RepoName = "fortress-store-list",
    [switch]$Private
)

$ErrorActionPreference = "Stop"
$repoDir = "D:\DSH\fortress-store-list"
Set-Location $repoDir

Write-Host "=== 1/4 登入 GitHub ===" -ForegroundColor Cyan
$env:GH_TOKEN = $Token
gh auth login --with-token | Out-Null
if ($LASTEXITCODE -ne 0) { throw "gh auth login 失敗" }
$user = gh api user --jq .login
Write-Host "已登入: $user" -ForegroundColor Green

Write-Host "=== 2/4 建立 repo 並推送 ===" -ForegroundColor Cyan
$visibility = if ($Private) { "--private" } else { "--public" }
gh repo create $RepoName $visibility --source . --remote origin --push 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    # repo 可能已存在, 直接設 remote 並推送
    git remote remove origin 2>$null
    git remote add origin "https://github.com/$user/$RepoName.git"
    git push -u origin main
}
Write-Host "repo: https://github.com/$user/$RepoName" -ForegroundColor Green

Write-Host "=== 3/4 開通 GitHub Pages ===" -ForegroundColor Cyan
# 用 API 設定 Pages 來源為 GitHub Actions
gh api -X POST "repos/$user/$RepoName/pages" -f "source[branch]=main" -f "source[path]=/" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Pages 可能已開通, 嘗試更新..." -ForegroundColor Yellow
    gh api -X PUT "repos/$user/$RepoName/pages" -f "source[branch]=main" -f "source[path]=/" 2>&1 | Out-Null
}

Write-Host "=== 4/4 手動觸發一次 workflow 驗證流水線 ===" -ForegroundColor Cyan
gh workflow run "每日更新豐澤分店清單" --repo "$user/$RepoName" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    gh workflow run update-and-deploy.yml --repo "$user/$RepoName" 2>&1 | Out-Null
}

Write-Host ""
Write-Host "部署完成！" -ForegroundColor Green
Write-Host "線上網址: https://$user.github.io/$RepoName/" -ForegroundColor Yellow
Write-Host "首次部署需等 GitHub Actions 完成 (約1-2分鐘), 之後每日自動更新。" -ForegroundColor Yellow
Write-Host "查看 Actions: https://github.com/$user/$RepoName/actions" -ForegroundColor Yellow

# 清理 token 環境變數
Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
