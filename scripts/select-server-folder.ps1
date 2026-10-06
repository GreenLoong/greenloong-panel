Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$dialog=New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description='Select the existing Minecraft server folder (containing server.properties)'
$dialog.ShowNewFolderButton=$false
try{if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){@{directory=$dialog.SelectedPath} | ConvertTo-Json -Compress}else{'{"directory":null}'}}finally{$dialog.Dispose()}
