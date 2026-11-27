param(
    [Parameter(Mandatory=$true)][string]$Tag,
    [string]$SigningKeyPath,
    [string]$SigningPasswordPath
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$versionOutput = & node (Join-Path $PSScriptRoot 'prepare-app-version-from-tag.mjs') $Tag --json
if ($LASTEXITCODE -ne 0) { throw 'Invalid release tag' }
$version = $versionOutput | ConvertFrom-Json
if (!$env:TAURI_SIGNING_PRIVATE_KEY -and !$SigningKeyPath) { throw 'An openAgent updater signing key is required' }
$previousKey = $env:TAURI_SIGNING_PRIVATE_KEY
$previousPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
try {
    if ($SigningKeyPath) { $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -LiteralPath $SigningKeyPath -Raw).Trim() }
    if ($SigningPasswordPath) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content -LiteralPath $SigningPasswordPath -Raw).Trim() }
    $env:LIVEAGENT_APP_VERSION = $version.appVersion
    $env:LIVEAGENT_KBRAIN_RELEASE = '1'
    $env:OPENAGENT_RELEASE_TAG = $version.releaseTag
    $env:GITHUB_REPOSITORY = 'OAO11/openAgent'
    $env:NODE_USE_ENV_PROXY = '1'
    Push-Location $repo
    try {
        $overlay = 'crates/agent-gui/src-tauri/tauri.version.generated.conf.json'
        & node scripts/release/prepare-app-version-from-tag.mjs $Tag --tauri-config $overlay
        if ($LASTEXITCODE -ne 0) { throw 'Version configuration failed' }
        & node scripts/release/prepare-kbrain.mjs --release
        if ($LASTEXITCODE -ne 0) { throw 'Locked K-brain preparation failed' }
        & npx.cmd --yes pnpm@10.32.1 --filter liveagent tauri build --bundles nsis --config src-tauri/tauri.windows.release.conf.json --config src-tauri/tauri.version.generated.conf.json
        if ($LASTEXITCODE -ne 0) { throw 'Windows Setup build failed' }
        $installer = Join-Path $repo "target/release/bundle/nsis/openAgent_$($version.appVersion)_x64-setup.exe"
        if (!(Test-Path -LiteralPath ($installer+'.sig'))) { throw 'Signed updater installer is missing' }
        $output = Join-Path $repo "dist/releases/$Tag"
        New-Item -ItemType Directory -Force $output | Out-Null
        $name = "openAgent-$Tag-Windows-x64-Setup.exe"
        Copy-Item -LiteralPath $installer -Destination (Join-Path $output $name)
        Copy-Item -LiteralPath ($installer+'.sig') -Destination (Join-Path $output ($name+'.sig'))
        & node scripts/release/create-tauri-updater-manifest.mjs $output (Join-Path $output 'latest.json')
        if ($LASTEXITCODE -ne 0) { throw 'Updater manifest generation failed' }
        & node scripts/release/verify-updater-artifact.mjs (Join-Path $output $name) crates/agent-gui/src-tauri/updater-public-key.txt
        if ($LASTEXITCODE -ne 0) { throw 'Updater signature verification failed' }
        $checksums = @($name, ($name+'.sig'), 'latest.json') | ForEach-Object {
            $hash = (Get-FileHash -LiteralPath (Join-Path $output $_) -Algorithm SHA256).Hash.ToLowerInvariant()
            "$hash  $_"
        }
        [IO.File]::WriteAllLines((Join-Path $output 'SHA256SUMS.txt'), $checksums)
        Write-Output "Release artifacts: $output"
    } finally { Pop-Location }
} finally {
    $env:TAURI_SIGNING_PRIVATE_KEY = $previousKey
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previousPassword
    Remove-Item Env:LIVEAGENT_KBRAIN_RELEASE -ErrorAction SilentlyContinue
    Remove-Item Env:LIVEAGENT_APP_VERSION -ErrorAction SilentlyContinue
}
