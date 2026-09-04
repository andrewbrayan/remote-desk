; Electron Builder's default process check can report a false positive on
; some Windows installations. The repair installer skips that check. Users
; should close the agent with its "Cerrar completamente" button first.
!macro customCheckAppRunning
!macroend
