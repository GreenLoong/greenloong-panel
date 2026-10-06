[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding
$basic=Get-Service -Name ddns-go -ErrorAction SilentlyContinue
if(-not $basic){'{"exists":false,"readable":true}';exit 0}
try{
 $s=Get-CimInstance Win32_Service -Filter "Name='ddns-go'" -ErrorAction Stop
 $exe=[regex]::Match($s.PathName,'(?i)^\s*(?:"([^"]+ddns-go\.exe)"|([^\s]+ddns-go\.exe))');$cfg=[regex]::Match($s.PathName,'(?i)(?:^|\s)-c\s+(?:"([^"]+)"|([^\s]+))')
 $exePath=if($exe.Groups[1].Success){$exe.Groups[1].Value}else{$exe.Groups[2].Value};$cfgPath=if($cfg.Groups[1].Success){$cfg.Groups[1].Value}else{$cfg.Groups[2].Value}
 @{exists=$true;readable=$true;exe=$exePath;config=$cfgPath;binaryPath=$s.PathName;status=$s.State;pid=$s.ProcessId} | ConvertTo-Json -Compress
}catch{@{exists=$true;readable=$false;status=$basic.Status.ToString()} | ConvertTo-Json -Compress}
