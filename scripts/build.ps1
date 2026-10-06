$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$out=Join-Path (Split-Path $root -Parent) ('release-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$stage=Join-Path $out 'GreenLoongLauncher'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
# Deliberate allowlist: runtime data, uploaded worlds and credentials never enter release.
foreach($name in @('lib','public','scripts','runtime','tests','README.md','package.json','server.mjs','launcher.mjs','run-server.mjs','Launch.cmd','StartServer.cmd','StopServer.cmd','ApplyNetwork.cmd','使用说明.md')) {
 Copy-Item -LiteralPath (Join-Path $root $name) -Destination $stage -Recurse
}
$zip=Join-Path (Split-Path $root -Parent) 'GreenLoong-Deploy-0.12.zip'
if(Test-Path -LiteralPath $zip){$zip=Join-Path $out 'GreenLoong-Deploy-0.12.zip'}
Compress-Archive -LiteralPath $stage -DestinationPath $zip -CompressionLevel Optimal
Get-FileHash -LiteralPath $zip -Algorithm SHA256 | Format-List
Write-Output $zip
