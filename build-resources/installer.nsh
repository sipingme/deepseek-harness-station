!macro customInstall
  ; Repair a missing Start menu link when upgrading an existing installation.
  CreateDirectory "$SMPROGRAMS\${MENU_FILENAME}"
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${ifNot} ${isNoDesktopShortcut}
    CreateDirectory "$DESKTOP"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}
  CreateShortCut "$SMPROGRAMS\${MENU_FILENAME}\卸载 Uninstall ${PRODUCT_NAME}.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\${UNINSTALL_FILENAME}" 0
!macroend

!macro customUnInstall
  ; Only remove links owned by Station; leave user data and workspaces intact.
  Delete "$SMPROGRAMS\${MENU_FILENAME}\卸载 Uninstall ${PRODUCT_NAME}.lnk"
!macroend
