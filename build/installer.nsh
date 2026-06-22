!macro stopNekoPresenceAgent
  IfFileExists "$INSTDIR\NekoPresenceAgent.exe" 0 +3
    nsExec::ExecToStack '"$INSTDIR\NekoPresenceAgent.exe" --shutdown-for-update'
    Pop $0
!macroend

!macro customInit
  !insertmacro stopNekoPresenceAgent
!macroend

!macro customUnInit
  !insertmacro stopNekoPresenceAgent
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NekoStatusPresenceAgent"
!macroend
