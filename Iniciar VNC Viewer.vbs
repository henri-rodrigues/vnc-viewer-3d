' Inicia o servidor local sem janela de console e abre o navegador.
' Se ja estiver rodando, apenas abre o navegador.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "node """ & dir & "\server.js"" --open", 0, False
