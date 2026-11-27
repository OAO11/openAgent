; Repair only existing shortcuts belonging to this installation. Updating the
; icon in place preserves arguments, working directory and AppUserModelID.
!include "LogicLib.nsh"
!include "Win\COM.nsh"

Var OpenAgentShortcutTarget
Var OpenAgentShortcutIcon
Var OpenAgentDesktopShortcut
Var OpenAgentStartMenuShortcut
Var OpenAgentLegacyStartMenuShortcut

!macro OpenAgentRepairShortcut Shortcut
  ${If} ${FileExists} "${Shortcut}"
    Push $0
    Push $1
    Push $2
    Push $3
    StrCpy $0 0
    StrCpy $1 0
    !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
    ${If} $0 P<> 0
      ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
      ${If} $1 P<> 0
        ${IPersistFile::Load} $1 '("${Shortcut}", ${STGM_READWRITE}).r3'
        ${If} $3 = 0
          ${IShellLink::GetPath} $0 '(.r2, ${NSIS_MAX_STRLEN}, 0, 0).r3'
          ${If} $3 = 0
          ${AndIf} $2 == $OpenAgentShortcutTarget
            ${IShellLink::SetIconLocation} $0 '("$OpenAgentShortcutIcon", 0).r3'
            ${If} $3 = 0
              ${IPersistFile::Save} $1 '("${Shortcut}", 1).r3'
              ${If} $3 = 0
                ; SHCNE_UPDATEITEM + SHCNF_PATHW refreshes this shortcut.
                System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x5, w "${Shortcut}", p 0)'
              ${Else}
                DetailPrint 'Could not save the openAgent shortcut icon: ${Shortcut}'
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
        ${IUnknown::Release} $1 ""
      ${EndIf}
      ${IUnknown::Release} $0 ""
    ${EndIf}
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  ${EndIf}
!macroend

Function OpenAgentRefreshShortcutIcons
  ; Also guards cancelled installs, before POSTINSTALL initializes these paths.
  ${If} ${FileExists} "$OpenAgentShortcutTarget"
  ${AndIf} ${FileExists} "$OpenAgentShortcutIcon"
    !insertmacro OpenAgentRepairShortcut "$OpenAgentDesktopShortcut"
    !insertmacro OpenAgentRepairShortcut "$OpenAgentStartMenuShortcut"
    !insertmacro OpenAgentRepairShortcut "$OpenAgentLegacyStartMenuShortcut"
    ; Refresh shell icon associations without restarting Explorer or deleting caches.
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $OpenAgentShortcutTarget "$INSTDIR\${MAINBINARYNAME}.exe"
  StrCpy $OpenAgentShortcutIcon "$INSTDIR\icons\openagent-logo.ico"
  StrCpy $OpenAgentDesktopShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
  StrCpy $OpenAgentStartMenuShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  StrCpy $OpenAgentLegacyStartMenuShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ; Silent installs and /UPDATE already have their shortcuts at this point.
  Call OpenAgentRefreshShortcutIcons
!macroend

Function .onGUIEnd
  ; Interactive Tauri installs create the desktop shortcut on the finish page,
  ; after POSTINSTALL. Repair it when that page closes as well.
  Call OpenAgentRefreshShortcutIcons
FunctionEnd
