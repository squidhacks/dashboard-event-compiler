' Starts the personal dashboard with no visible window and keeps it running.
'
' Windows Task Scheduler runs this at logon. It restarts node if node dies
' unexpectedly, and stops only when node exits with code 0, which server.js
' uses to mean "this shutdown was intentional" (Ctrl+C, SIGTERM, or the port
' already being held by another instance).
'
' Usage: wscript.exe launch-hidden.vbs ["C:\path\to\node.exe"]

Option Explicit

Dim fso, shell, root, logPath, nodeExe, inner, cmdLine, code

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
logPath = fso.BuildPath(root, "server.log")

If WScript.Arguments.Count > 0 Then
  nodeExe = WScript.Arguments(0)
Else
  nodeExe = "node.exe"
End If

shell.CurrentDirectory = root

' cmd.exe does the append-redirect so the log stays live while node runs.
' The doubled outer quotes are the standard cmd /c form for a quoted program.
inner = """" & nodeExe & """ server.js >> """ & logPath & """ 2>&1"
cmdLine = "cmd /c """ & inner & """"

Do
  RotateLog
  code = shell.Run(cmdLine, 0, True)
  If code = 0 Then Exit Do
  WScript.Sleep 5000
Loop

WScript.Quit 0

' Keep the log from growing without bound over months of uptime.
Sub RotateLog
  Dim f, backup
  If Not fso.FileExists(logPath) Then Exit Sub
  Set f = fso.GetFile(logPath)
  If f.Size < 2097152 Then Exit Sub
  backup = logPath & ".1"
  If fso.FileExists(backup) Then fso.DeleteFile backup, True
  f.Move backup
End Sub
