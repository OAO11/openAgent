# Source inspiration: affaan-m/everything-claude-code; Windows adaptation by openAgent.
# MIT License
# 
# Copyright (c) 2026 Affaan Mustafa
# 
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
# 
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
# 
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

# openAgent Windows adaptation of ECC's end-of-turn development checks (MIT).
# OpenAgentCheck is set by the preset. No downloads or automatic dependency installation.
$ErrorActionPreference = 'Stop'
$check = $OpenAgentCheck
$workdir = $env:LIVEAGENT_WORKDIR
$reportBase = $env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($reportBase)) { $reportBase = [Environment]::GetFolderPath('LocalApplicationData') }
$reportRoot = Join-Path $reportBase 'openAgent\hook-reports'
if (![string]::IsNullOrWhiteSpace($env:OPENAGENT_DATA_DIR)) {
    $reportRoot = Join-Path $env:OPENAGENT_DATA_DIR 'hook-reports'
}
function Write-CheckReport([string]$Status, [string[]]$Details) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $key = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$workdir))).Replace('-', '').Substring(0, 16) }
    finally { $hasher.Dispose() }
    $folder = Join-Path $reportRoot $key
    [IO.Directory]::CreateDirectory($folder) | Out-Null
    $report = @{ check = $check; status = $Status; at = [DateTimeOffset]::Now.ToString('o'); workdir = $workdir; details = @($Details) }
    $path = Join-Path $folder ($check + '.json')
    [IO.File]::WriteAllText($path, ($report | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
    Write-Output ('openAgent ' + $check + ': ' + $Status + '. Report: ' + $path)
}
function Invoke-CheckCommand([string]$Executable, [string[]]$Arguments) {
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $script:checkOutput = @(& $Executable @Arguments 2>&1 | ForEach-Object { $_.ToString() })
        $script:checkExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
}
try {
    if ([string]::IsNullOrWhiteSpace($workdir) -or -not (Test-Path -LiteralPath $workdir -PathType Container)) {
        throw 'Select an existing project workspace before enabling this hook.'
    }
    Set-Location -LiteralPath $workdir
    if ($check -eq 'git-diff') {
        $git = Get-Command git.exe -ErrorAction Stop
        Invoke-CheckCommand $git.Source @('rev-parse', '--is-inside-work-tree')
        if ($checkExit -ne 0) { throw 'This workspace is not inside a Git repository.' }
        $allOutput = @()
        $failed = $false
        foreach ($mode in @('working', 'staged')) {
            $gitArgs = @('--no-pager', 'diff', '--check')
            if ($mode -eq 'staged') { $gitArgs += '--cached' }
            Invoke-CheckCommand $git.Source $gitArgs
            $allOutput += @($mode) + $checkOutput
            if ($checkExit -ne 0) { $failed = $true }
        }
        if ($failed) { Write-CheckReport 'failed' $allOutput; exit 1 }
        Write-CheckReport 'passed' @('Tracked working-tree and staged changes passed git diff --check. Untracked files are not checked.')
        exit 0
    }
    $packagePath = Join-Path $workdir 'package.json'
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        Write-CheckReport 'skipped' @('No package.json at workspace root. Adapt this preset for this project before use.'); exit 0
    }
    $package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $candidates = switch ($check) {
        'typecheck' { @('openagent:hook:typecheck', 'typecheck', 'check:types') }
        'lint' { @('openagent:hook:lint', 'lint:check', 'lint') }
        'test' { @('openagent:hook:test', 'test:ci', 'test:run') }
        default { throw 'Unsupported project check.' }
    }
    $selected = $null
    foreach ($candidate in $candidates) {
        if ($package.scripts -and $package.scripts.PSObject.Properties[$candidate] -and $package.scripts.$candidate -is [string] -and $package.scripts.$candidate.Trim()) {
            $selected = $candidate; break
        }
    }
    if (-not $selected) {
        Write-CheckReport 'skipped' @('Define one of these non-interactive package scripts: ' + ($candidates -join ', ')); exit 0
    }
    $manager = if ($package.packageManager -match '^(npm|pnpm|yarn)@') { $Matches[1] }
        elseif (Test-Path -LiteralPath (Join-Path $workdir 'pnpm-lock.yaml')) { 'pnpm' }
        elseif (Test-Path -LiteralPath (Join-Path $workdir 'yarn.lock')) { 'yarn' }
        else { 'npm' }
    $runner = Get-Command ($manager + '.cmd') -ErrorAction Stop
    # The project's selected script determines its behavior. Do not add --fix or a watch mode.
    Invoke-CheckCommand $runner.Source @('run', $selected)
    if ($checkExit -ne 0) { Write-CheckReport 'failed' $checkOutput; exit 1 }
    Write-CheckReport 'passed' $checkOutput
    exit 0
} catch {
    Write-CheckReport 'failed' @($_.Exception.Message)
    exit 2
}
