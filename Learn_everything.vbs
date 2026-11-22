Option Explicit

Dim fso, shell, appDir, envPath, nodeExe, candidates, item, exitCode, cmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = appDir

If Not fso.FolderExists(fso.BuildPath(appDir, "node_modules")) Then
  MsgBox "Missing node_modules. Please run start.bat once to install dependencies first.", vbExclamation, "Learn_everything"
  WScript.Quit 1
End If

nodeExe = ""
candidates = Array( _
  shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe"), _
  shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\nodejs\node.exe"), _
  shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\node\node.exe"), _
  "D:\Program Files\nodejs\node.exe" _
)

For Each item In candidates
  If Len(item) > 0 And fso.FileExists(item) Then
    nodeExe = item
    Exit For
  End If
Next

If nodeExe = "" Then
  envPath = shell.ExpandEnvironmentStrings("%PATH%")
  For Each item In Split(envPath, ";")
    item = Trim(item)
    If Len(item) > 0 Then
      If fso.FileExists(fso.BuildPath(item, "node.exe")) Then
        nodeExe = fso.BuildPath(item, "node.exe")
        Exit For
      End If
    End If
  Next
End If

If nodeExe = "" Then
  MsgBox "Node.js was not found. Please install Node.js LTS or run start.bat.", vbCritical, "Learn_everything"
  WScript.Quit 1
End If

cmd = """" & nodeExe & """ """ & fso.BuildPath(appDir, "scripts\service-manager.mjs") & """ start --silent"
exitCode = shell.Run(cmd, 0, True)

If exitCode <> 0 Then
  MsgBox "Learn_everything background service failed to start (code " & exitCode & ")." & vbCrLf & _
         "Check data\logs\server.log or run start.bat to see detailed output.", vbCritical, "Learn_everything"
  WScript.Quit exitCode
End If
