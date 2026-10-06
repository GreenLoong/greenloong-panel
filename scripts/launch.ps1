param([switch]$StartServer,[switch]$StopServer,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
if($StartServer -and $StopServer){throw 'Choose either start or stop, not both.'}
$root=Split-Path $PSScriptRoot -Parent
$node=Join-Path $root 'runtime\node.exe'
$script=Join-Path $root 'launcher.mjs'
$sha=[Security.Cryptography.SHA256]::Create()
try{$lockId=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($root).ToLowerInvariant())))).Replace('-','').Substring(0,24)}finally{$sha.Dispose()}
$launchMutex=New-Object System.Threading.Mutex($false,('Local\GreenLoongLauncher-'+$lockId))
$locked=$false
try{
 try{$locked=$launchMutex.WaitOne(15000)}catch [System.Threading.AbandonedMutexException]{$locked=$true}
 if(-not $locked){throw 'The launcher is starting. Please try again shortly.'}
 [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding
 $launchArgs=@($script)
 if($StartServer){$launchArgs+='--start'}
 if($StopServer){$launchArgs+='--stop'}
 if($NoBrowser){$launchArgs+='--no-browser'}
 & $node @launchArgs
 exit $LASTEXITCODE
}finally{if($locked){$launchMutex.ReleaseMutex()};$launchMutex.Dispose()}
