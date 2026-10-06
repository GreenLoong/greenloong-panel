param([int]$Port=18640)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding
$listeners=@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object {$_.Port -eq $Port})
if(-not $listeners.Count){'{"occupied":false,"owners":[]}';exit 0}
$owners=@();$readable=$true
try{
 $ids=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
 foreach($ownerId in $ids){$p=Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId" -ErrorAction Stop
  if($p){$match=[regex]::Match($p.CommandLine,'(?i)(?:^|\s)"([^"\r\n]+\.(?:mjs|js))"|(?:^|\s)([^\s"]+\.(?:mjs|js))(?=\s|$)');$entry=$null;if($match.Success){if($match.Groups[1].Success){$entry=$match.Groups[1].Value}else{$entry=$match.Groups[2].Value}}
   $owners+=@{pid=[int]$p.ProcessId;exe=$p.ExecutablePath;script=$entry;name=$p.Name}
  }
 }
}catch{$readable=$false}
@{occupied=$true;owners=$owners;processInfoReadable=$readable} | ConvertTo-Json -Depth 5 -Compress
