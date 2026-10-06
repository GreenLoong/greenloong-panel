param([Parameter(Mandatory=$true)][string]$Request)
$ErrorActionPreference='Stop'
$migration=$null
try {
 $a=Get-Content -LiteralPath $Request -Raw -Encoding UTF8 | ConvertFrom-Json
 $port=[int]$a.port
 if($port -lt 1024 -or $port -gt 65535 -or $port -in @(23333,24444,9876) -or ($port -ge 18640 -and $port -le 18660)){throw 'Invalid game port'}
 if($a.firewall){
  # Named rules are scoped to this tool. Existing unrelated rules are never removed.
  foreach($protocol in @('TCP','UDP')){
   $name="GreenLoong-Minecraft-$port-$protocol"
   $old=Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
   if(-not $old){New-NetFirewallRule -Name $name -DisplayName $name -Direction Inbound -Action Allow -Protocol $protocol -LocalPort $port -Profile Any | Out-Null}
  }
 }
 if($a.ddns){
  $exe=[IO.Path]::GetFullPath($a.ddnsExe)
  $cfg=[IO.Path]::GetFullPath($a.ddnsConfig)
  if([IO.Path]::GetFileName($exe) -ne 'ddns-go.exe'){throw 'Invalid DDNS binary'}
  $existing=Get-CimInstance Win32_Service -Filter "Name='ddns-go'"
  if($existing){
   if(-not $existing.PathName.Contains($exe) -or -not $existing.PathName.Contains($cfg)){
    if(-not $a.takeOverDdns -or $existing.PathName -ne $a.expectedServiceBinaryPath -or $existing.PathName -notmatch '(?i)greenloong'){throw 'Existing ddns-go belongs to another installation. Inspect and explicitly approve takeover first.'}
    $oldConfigMatch=[regex]::Match($existing.PathName,'(?i)(?:^|\s)-c\s+(?:"([^"]+)"|([^\s]+))')
    $oldConfig=if($oldConfigMatch.Groups[1].Success){$oldConfigMatch.Groups[1].Value}else{$oldConfigMatch.Groups[2].Value}
    if(-not $oldConfig -or -not (Test-Path -LiteralPath $oldConfig)){throw 'Cannot safely read old DDNS configuration.'}
    $oldData=Get-Content -LiteralPath $oldConfig -Raw -Encoding UTF8 | ConvertFrom-Json
    $oldDomains=@($oldData.dnsconf | ForEach-Object { @($_.ipv4.domains)+@($_.ipv6.domains) } | Where-Object {$_} | ForEach-Object {($_ -split '\?')[0]} | Sort-Object -Unique)
    if($oldDomains.Count -ne 1 -or $oldDomains[0] -ne $a.expectedLegacyDomain){throw 'Old DDNS manages other domains or changed after preview; automatic takeover was refused.'}
    $backupDir=Join-Path (Split-Path $cfg -Parent) ('ddns-service-backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Copy-Item -LiteralPath $oldConfig -Destination (Join-Path $backupDir 'old-ddns-config.backup')
    $migration=@{path=$existing.PathName;mode=$existing.StartMode;running=($existing.State -eq 'Running')}
    $migration | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupDir 'service.json') -Encoding UTF8
    Stop-Service -Name ddns-go -ErrorAction Stop
    (Get-Service ddns-go).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))
    $newPath='"'+$exe+'" -l 127.0.0.1:9876 -f 60 -cacheTimes 5 -c "'+$cfg+'" -noweb'
    $changed=Invoke-CimMethod -InputObject $existing -MethodName Change -Arguments @{PathName=$newPath;StartMode='Automatic'}
    if($changed.ReturnValue -ne 0){throw 'Could not change DDNS service registration.'}
    Start-Service -Name ddns-go
   }else{Restart-Service -Name ddns-go}
  } else {
   & $exe -s install -l 127.0.0.1:9876 -f 60 -c $cfg -noweb | Out-Null
  }
  if((Get-Service ddns-go).Status -ne 'Running'){throw 'DDNS service did not start'}
  $actual=Get-CimInstance Win32_Service -Filter "Name='ddns-go'"
  if(-not $actual.PathName.Contains($exe) -or -not $actual.PathName.Contains($cfg)){throw 'DDNS registration changed during setup; ownership could not be verified.'}
 }
 @{ok=$true} | ConvertTo-Json | Set-Content -LiteralPath ($Request+'.result') -Encoding UTF8
 exit 0
} catch {
 $errorMessage=$_.Exception.Message;$rollbackOk=$null
 if($migration){try{Stop-Service -Name ddns-go -ErrorAction SilentlyContinue;$restoreMode=if($migration.mode -eq 'Auto'){'Automatic'}else{$migration.mode};$svc=Get-CimInstance Win32_Service -Filter "Name='ddns-go'";$restored=Invoke-CimMethod -InputObject $svc -MethodName Change -Arguments @{PathName=$migration.path;StartMode=$restoreMode};if($migration.running -and $restored.ReturnValue -eq 0){Start-Service -Name ddns-go};$rollbackOk=($restored.ReturnValue -eq 0)}catch{$rollbackOk=$false};$errorMessage+='; old DDNS service rollback verified: '+$rollbackOk}
 @{ok=$false;error=$errorMessage;rollbackVerified=$rollbackOk} | ConvertTo-Json | Set-Content -LiteralPath ($Request+'.result') -Encoding UTF8
 exit 1
}
