!macro NSIS_HOOK_PREUNINSTALL
  ; Remove only NetF's fixed scheduled task. No user-controlled command is executed.
  nsExec::ExecToLog '"$SYSDIR\schtasks.exe" /Delete /TN "NetF Startup" /F'
!macroend
