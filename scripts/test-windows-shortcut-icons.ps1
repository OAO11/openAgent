param([string]$MakeNsis = 'makensis.exe')
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('openagent-shortcut-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $scratch | Out-Null
Copy-Item (Join-Path $repo 'crates/agent-gui/src-tauri/windows/shortcut-icons.nsh') $scratch
$source = @'
Unicode true
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "shortcut-icons.nsh"
Name "openAgent shortcut regression fixture"
OutFile "shortcut-fixture.exe"
RequestExecutionLevel user
SilentInstall silent
Section
  ${GetParameters} $R0
  ${GetOptions} $R0 "/ROOT=" $INSTDIR
  StrCpy $OpenAgentShortcutTarget "$INSTDIR\openAgent.exe"
  StrCpy $OpenAgentShortcutIcon "$INSTDIR\icons\openagent-logo.ico"
  StrCpy $OpenAgentDesktopShortcut "$INSTDIR\desktop.lnk"
  StrCpy $OpenAgentStartMenuShortcut "$INSTDIR\start-menu.lnk"
  StrCpy $OpenAgentLegacyStartMenuShortcut "$INSTDIR\legacy-menu.lnk"
  Call OpenAgentRefreshShortcutIcons
  ; Tauri's interactive finish page creates the desktop link after POSTINSTALL.
  ClearErrors
  ${GetOptions} $R0 "/FINISH" $R1
  ${IfNot} ${Errors}
    CreateShortcut "$OpenAgentDesktopShortcut" "$OpenAgentShortcutTarget"
    Call .onGUIEnd
  ${EndIf}
SectionEnd
'@
$source | Set-Content (Join-Path $scratch 'fixture.nsi')
Push-Location $scratch
try {
    & $MakeNsis /V2 fixture.nsi
    if ($LASTEXITCODE -ne 0) { throw 'Failed to compile shortcut fixture' }
} finally { Pop-Location }
$shell = New-Object -ComObject WScript.Shell
$results = @()
foreach ($case in @('fresh', 'update', 'finish-page', 'no-shortcuts', 'other-install', 'missing-icon')) {
    $root = Join-Path $scratch "$case install 中文"
    New-Item -ItemType Directory -Force (Join-Path $root 'icons'), (Join-Path $root 'data') | Out-Null
    $target = Join-Path $root 'openAgent.exe'
    $icon = Join-Path $root 'icons/openagent-logo.ico'
    Copy-Item (Join-Path $scratch 'shortcut-fixture.exe') $target
    'preserve data' | Set-Content (Join-Path $root 'data/sentinel')
    if ($case -ne 'missing-icon') {
        Copy-Item (Join-Path $repo 'crates/agent-gui/src-tauri/icons/icon-windows.ico') $icon
    }
    $names = @('desktop', 'start-menu', 'legacy-menu')
    foreach ($name in $names) {
        if ($case -eq 'no-shortcuts' -or ($case -eq 'finish-page' -and $name -eq 'desktop')) { continue }
        $link = $shell.CreateShortcut((Join-Path $root "$name.lnk"))
        $link.TargetPath = if ($case -eq 'other-install') { Join-Path $root 'other.exe' } else { $target }
        $link.Arguments = '--fixture preserve'
        $link.WorkingDirectory = $root
        $link.Description = 'Preserve shortcut metadata'
        $link.IconLocation = "$target,0"
        $link.Save()
    }
    $arguments = @("/ROOT=`"$root`"")
    if ($case -eq 'finish-page') { $arguments += '/FINISH' }
    foreach ($attempt in 1..2) {
        $process = Start-Process (Join-Path $scratch 'shortcut-fixture.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
        if ($process.ExitCode -ne 0) { throw "Shortcut fixture failed: $case" }
    }
    $pass = (Get-Content (Join-Path $root 'data/sentinel') -Raw).Trim() -eq 'preserve data'
    foreach ($name in $names) {
        $path = Join-Path $root "$name.lnk"
        if ($case -eq 'no-shortcuts') {
            $pass = $pass -and !(Test-Path $path)
            continue
        }
        $link = $shell.CreateShortcut($path)
        $expectedIcon = if ($case -in @('other-install', 'missing-icon')) { "$target,0" } else { "$icon,0" }
        $pass = $pass -and ($link.IconLocation -eq $expectedIcon)
        if ($case -eq 'other-install') {
            $pass = $pass -and ($link.TargetPath -eq (Join-Path $root 'other.exe'))
        } else {
            $pass = $pass -and ($link.TargetPath -eq $target)
        }
        if (!($case -eq 'finish-page' -and $name -eq 'desktop')) {
            $pass = $pass -and ($link.Arguments -eq '--fixture preserve') -and ($link.WorkingDirectory -eq $root) -and ($link.Description -eq 'Preserve shortcut metadata')
        }
    }
    $results += [pscustomobject]@{ case = $case; pass = $pass }
}
$results | ConvertTo-Json | Set-Content (Join-Path $scratch 'results.json')
$results | Format-Table
Write-Output "Fixture output: $scratch"
if (@($results | Where-Object { !$_.pass }).Count) { throw 'Shortcut icon regression failed' }
