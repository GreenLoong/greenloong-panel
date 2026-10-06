param([string]$Action)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$a = [Console]::In.ReadToEnd() | ConvertFrom-Json
switch ($Action) {
 'ddns-state' {
  $service=Get-Service -Name ddns-go -ErrorAction SilentlyContinue
  @{running=($null -ne $service -and $service.Status -eq 'Running')} | ConvertTo-Json -Compress
 }
 'network' {
  $addresses = @(foreach($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
   if($nic.OperationalStatus -ne 'Up'){continue}
   foreach($ip in $nic.GetIPProperties().UnicastAddresses){
    if($ip.Address.ToString() -match '^[23][0-9a-fA-F]{3}:' -and $ip.DuplicateAddressDetectionState -eq 'Preferred') {
     [pscustomobject]@{address=$ip.Address.ToString();name=$nic.Name;guid=$nic.Id;temporary=($ip.IsTransient -or $ip.SuffixOrigin -eq 'Random')}
    }
   }
  })
  $machineId=$null
  try{$machineGuid=(Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Cryptography').MachineGuid;$sha=[Security.Cryptography.SHA256]::Create();try{$machineId=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($machineGuid)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}catch{}
  @{ addresses=$addresses; machineId=$machineId; admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } | ConvertTo-Json -Depth 5 -Compress
 }
 'ports' {
  $ports = @($a.ports | ForEach-Object {[int]$_})
  $net=[System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties()
  $tcp = @($net.GetActiveTcpListeners() | Where-Object { $ports -contains $_.Port } | ForEach-Object { @{protocol='TCP';port=$_.Port;address=$_.Address.ToString();pid='unknown'} })
  $udp = @($net.GetActiveUdpListeners() | Where-Object { $ports -contains $_.Port } | ForEach-Object { @{protocol='UDP';port=$_.Port;address=$_.Address.ToString();pid='unknown'} })
  @{conflicts=@($tcp)+@($udp)} | ConvertTo-Json -Depth 5 -Compress
 }
 'protect' {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls.exe $a.path /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Could not restrict credential folder permissions'}
  '{"ok":true}'
 }
 'elevate' {
  $request = [IO.Path]::GetFullPath($a.request)
  $worker = Join-Path $PSScriptRoot 'privileged.ps1'
  $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $worker + '" -Request "' + $request + '"'
  $p = Start-Process powershell.exe -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
  if($p.ExitCode -ne 0){throw '管理员步骤未完成，请查看部署日志。'}
  '{"ok":true}'
 }
 default {throw 'Unknown action'}
}
