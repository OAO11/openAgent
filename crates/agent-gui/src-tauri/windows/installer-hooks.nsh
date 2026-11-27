; NSIS installer hooks for the openAgent Windows bundle.
;
; Tauri's stock uninstaller only removes $APPDATA\<identifier> and
; $LOCALAPPDATA\<identifier> when "Delete the application data" is ticked.
; openAgent keeps its persistent data (config, chat history, memory, skills,
; uploads, checkpoints, ...) under <installation directory>\data, so clean it here.

; Keep Tauri's legacy AppData cleanup away from the independent debug preview.
; Installed builds own only $INSTDIR\data. Preserve the UI selection for our hook.
Var OpenAgentDeleteAppData

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $OpenAgentDeleteAppData $DeleteAppDataCheckboxState
  ; Tauri 2.11.x does not yet parse the explicit silent-uninstall data flag.
  ; Honor it here while keeping /UPDATE protected by the conditions below.
  Push $0
  ClearErrors
  ${GetOptions} $CMDLINE "/DELETEAPPDATA" $0
  ${IfNot} ${Errors}
    StrCpy $OpenAgentDeleteAppData 1
  ${EndIf}
  ClearErrors
  Pop $0
  StrCpy $DeleteAppDataCheckboxState 0
  ; Same condition as Tauri's own app-data cleanup: checkbox ticked, and not an
  ; in-place update (updates also run the uninstaller and must keep user data).
  ${If} $OpenAgentDeleteAppData = 1
  ${AndIf} $UpdateMode <> 1
    ; Tauri kills the main process before POSTUNINSTALL. Kill the tree while
    ; its root still exists, otherwise children holding sqlite files survive.
    Push $0
    nsExec::Exec 'taskkill /F /T /IM "${MAINBINARYNAME}.exe"'
    Pop $0
    Pop $0
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $OpenAgentDeleteAppData = 1
  ${AndIf} $UpdateMode <> 1
    Push $1
    ; Retry a few times in case handles are released slightly late.
    StrCpy $1 0
    openagent_rmdir_retry:
      RMDir /r "$INSTDIR\data"
      ${IfNot} ${FileExists} "$INSTDIR\data"
        Goto openagent_rmdir_done
      ${EndIf}
      IntOp $1 $1 + 1
      ${If} $1 < 5
        Sleep 500
        Goto openagent_rmdir_retry
      ${EndIf}
      DetailPrint 'Could not remove "$INSTDIR\data": files may still be in use.'
      MessageBox MB_OK|MB_ICONEXCLAMATION 'openAgent was uninstalled, but some application data could not be deleted from "$INSTDIR\data". Close programs using these files and remove the remaining directory manually.' /SD IDOK
      SetErrorLevel 1
    openagent_rmdir_done:
    ; The stock uninstaller tried this before our data cleanup. Remove only an empty root.
    RMDir "$INSTDIR"
    Pop $1
  ${EndIf}
!macroend
