!macro _DRAGABYTE_WRITE_CONTEXT_MENU exePath
  ; Scan entries
  WriteRegStr HKCU "Software\Classes\Directory\shell\Dragabyte" "" "Scan with Dragabyte"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Dragabyte" "Icon" "${exePath}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Dragabyte\command" "" "$\"${exePath}$\" $\"%1$\""

  WriteRegStr HKCU "Software\Classes\Drive\shell\Dragabyte" "" "Scan with Dragabyte"
  WriteRegStr HKCU "Software\Classes\Drive\shell\Dragabyte" "Icon" "${exePath}"
  WriteRegStr HKCU "Software\Classes\Drive\shell\Dragabyte\command" "" "$\"${exePath}$\" $\"%1$\""

  WriteRegStr HKCU "Software\Classes\directory\Background\shell\Dragabyte" "" "Scan with Dragabyte"
  WriteRegStr HKCU "Software\Classes\directory\Background\shell\Dragabyte" "Icon" "${exePath}"
  WriteRegStr HKCU "Software\Classes\directory\Background\shell\Dragabyte\command" "" "$\"${exePath}$\" $\"%V$\""

  ; Rename entries
  WriteRegStr HKCU "Software\Classes\Directory\shell\DragabyteRename" "" "Rename with Dragabyte"
  WriteRegStr HKCU "Software\Classes\Directory\shell\DragabyteRename" "Icon" "${exePath}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\DragabyteRename" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\Directory\shell\DragabyteRename\command" "" "$\"${exePath}$\" --rename %*"

  WriteRegStr HKCU "Software\Classes\Drive\shell\DragabyteRename" "" "Rename with Dragabyte"
  WriteRegStr HKCU "Software\Classes\Drive\shell\DragabyteRename" "Icon" "${exePath}"
  WriteRegStr HKCU "Software\Classes\Drive\shell\DragabyteRename" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\Drive\shell\DragabyteRename\command" "" "$\"${exePath}$\" --rename %*"

  WriteRegStr HKCU "Software\Classes\directory\Background\shell\DragabyteRename" "" "Rename with Dragabyte"
  WriteRegStr HKCU "Software\Classes\directory\Background\shell\DragabyteRename" "Icon" "${exePath}"
  WriteRegStr HKCU "Software\Classes\directory\Background\shell\DragabyteRename" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\directory\Background\shell\DragabyteRename\command" "" "$\"${exePath}$\" --rename $\"%V$\""

  WriteRegStr HKCU "Software\Classes\*\shell\DragabyteRename" "" "Rename with Dragabyte"
  WriteRegStr HKCU "Software\Classes\*\shell\DragabyteRename" "Icon" "${exePath}"
  WriteRegStr HKCU "Software\Classes\*\shell\DragabyteRename" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\*\shell\DragabyteRename\command" "" "$\"${exePath}$\" --rename %*"
!macroend

!macro _DRAGABYTE_REMOVE_CONTEXT_MENU
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Dragabyte"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\Dragabyte"
  DeleteRegKey HKCU "Software\Classes\directory\Background\shell\Dragabyte"

  DeleteRegKey HKCU "Software\Classes\Directory\shell\DragabyteRename"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\DragabyteRename"
  DeleteRegKey HKCU "Software\Classes\directory\Background\shell\DragabyteRename"
  DeleteRegKey HKCU "Software\Classes\*\shell\DragabyteRename"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Default checked behavior: Yes is default selection.
  StrCpy $0 "$INSTDIR\${MAINBINARYNAME}.exe"
  IfSilent dragabyte_apply_menu
  MessageBox MB_YESNO|MB_DEFBUTTON1 "Add Dragabyte to the context menu?" IDYES dragabyte_apply_menu IDNO dragabyte_skip_menu
dragabyte_apply_menu:
  !insertmacro _DRAGABYTE_WRITE_CONTEXT_MENU "$0"
dragabyte_skip_menu:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro _DRAGABYTE_REMOVE_CONTEXT_MENU
!macroend
