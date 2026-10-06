param([Parameter(Mandatory=$true)][Guid]$InterfaceGuid)
$ErrorActionPreference='Stop'
$nic=[System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object { $_.Id.Trim('{}') -eq $InterfaceGuid.ToString() -and $_.OperationalStatus -eq 'Up' } | Select-Object -First 1
if(-not $nic){exit 1}
$ip=$nic.GetIPProperties().UnicastAddresses | Where-Object { $_.Address.ToString() -match '^[23][0-9a-fA-F]{3}:' -and $_.DuplicateAddressDetectionState -eq 'Preferred' -and -not $_.IsTransient -and $_.SuffixOrigin -ne 'Random' } | Select-Object -First 1
if(-not $ip){exit 2}
[Console]::WriteLine($ip.Address.ToString())
