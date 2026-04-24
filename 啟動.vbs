Dim objShell, strDir
Set objShell = CreateObject("WScript.Shell")
strDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
objShell.CurrentDirectory = strDir
objShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & strDir & "start-server.ps1""", 1, False
