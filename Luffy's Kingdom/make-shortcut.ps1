$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "Luffy's Kingdom.lnk"
$target = "C:\Users\Luffy\Desktop\Luffy's Kingdom\dist\Luffy's Kingdom-win32-x64\Luffy's Kingdom.exe"
$workdir = "C:\Users\Luffy\Desktop\Luffy's Kingdom\dist\Luffy's Kingdom-win32-x64"

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($shortcutPath)
$sc.TargetPath = $target
$sc.WorkingDirectory = $workdir
$sc.Description = "Luffy's Kingdom - Multi-account WhatsApp"
$sc.Save()
Write-Output "Shortcut created at: $shortcutPath"
