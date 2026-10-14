!macro customInit
  ; Old clients pass --updated even when quitAndInstall used its non-silent default.
  ${if} ${isUpdated}
    SetSilent silent
  ${endif}
!macroend

!macro customUnInstall
  ; Preserve the user's choice during an upgrade; remove our item on uninstall.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "cn.sustech.bbreader.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "cn.sustech.bbreader.desktop"
  ${endif}
!macroend
